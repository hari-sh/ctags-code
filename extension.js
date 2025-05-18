const vscode = require('vscode');
const ctagz = require('ctagz');
const fs = require('fs');
const regcmd = vscode.commands.registerCommand;
const path = require('path');
const lineReader = require('line-reader');
const Promise = require('bluebird');
const eachLine = Promise.promisify(lineReader.eachLine);
const msgpack = require('@msgpack/msgpack');
let taglist = [];

function activate(context) {
	context.subscriptions.push(regcmd('tagger.get_ctag', get_ctag));
	context.subscriptions.push(regcmd('tagger.get_taglist', getTaglist));
	context.subscriptions.push(regcmd('tagger.search', goToDefinition));
}

function deactivate() {}

async function goToDefinition(context) {
    if(taglist.length == 0) {
    const buffer = fs.readFileSync(path.join(vscode.workspace.rootPath,'tags.bin'));
    taglist = msgpack.decode(buffer);
    }
    const selected = await vscode.window.showQuickPick(taglist, {
    placeHolder: 'Choose a search query or type your own...',
    canPickMany: false,
  });
  return findCTags(context, selected);
}

function getTaglist() {
    const tags_got = []
    eachLine(path.join(vscode.workspace.rootPath, 'tags'), line => {
        if (!line.startsWith('!')) {
                const [tagName] = line.split('\t');
                tags_got.push(tagName);
        } 
    }).then(() => {
        const encoded = msgpack.encode(tags_got);
        const tagsbin = path.join(vscode.workspace.rootPath,'tags.bin');
        fs.writeFileSync(tagsbin, encoded);                
        });
}

function getTag(editor) {
    const tag = editor.document.getText(editor.selection).trim()
    if (!tag) {
        const range = editor.document.getWordRangeAtPosition(editor.selection.active)
        if (range) {
            return editor.document.getText(range)
        }
    }
    return tag
}

function findCTags(context, tag) {
    const editor = vscode.window.activeTextEditor
    let searchPath = vscode.workspace.rootPath

    if (editor && !editor.document.isUntitled && editor.document.uri.scheme === 'file') {
        searchPath = editor.document.fileName
    }

    if (!searchPath) {
        console.log('ctagsx: Could not get a path to search for tags file')
        if (editor) {
            console.log('ctagsx: Document is untitled? ', editor.document.isUntitled)
            console.log('ctagsx: Document URI:', editor.document.uri.toString())
        } else {
            console.log('ctagsx: Active text editor is undefined')
        }
        console.log('ctagsx: Workspace root: ', vscode.workspace.rootPath)
        return vscode.window.showWarningMessage(`ctagsx: No searchable path (no workspace folder open?)`)
    }

    ctagz.findCTagsBSearch(searchPath, tag)
        .then(result => {
            const options = result.results.map(tag => {
                if (!path.isAbsolute(tag.file)) {
                    tag.file = path.join(path.dirname(result.tagsFile), tag.file)
                }
                tag.tagKind = tag.kind
                tag.description = tag.tagKind || ''
                tag.label = tag.file
                tag.detail = tag.address.pattern || `Line ${tag.address.lineNumber}`
                delete tag.kind
                return tag
            })

            if (!options.length) {
                if (!result.tagsFile) {
                    return vscode.window.showWarningMessage(`ctagsx: No tags file found`)
                }
                return vscode.window.showInformationMessage(`ctagsx: No tags found for ${tag}`)
            } else if (options.length === 1) {
                return revealCTags(context, editor, options[0])
            } else {
                return vscode.window.showQuickPick(options).then(opt => {
                    return revealCTags(context, editor, opt)
                })
            }
        })
        .catch(err => {
            console.log(err.stack)
            vscode.window.showErrorMessage(`ctagsx: Search failed: ${err}`)
        })
}


function revealCTags(context, editor, entry) {
    if (!entry) {
        return
    }
    const document = editor ? editor.document : null
    const triggeredSel = editor ? editor.selection : null
    return getLineNumber(entry, document, triggeredSel).then(sel => {
        return openAndReveal(context, editor, entry.file, sel)
    })
}

function get_ctag(context) {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
        console.log('ctagsx: Cannot search - no active editor')
        return
    }
    const tag = getTag(editor)
    if (!tag) {
        return
    }
    return findCTags(context, tag)
}

function getLineNumber(entry, document, sel, canceller) {
    if (entry.address.lineNumber === 0) {
        return getLineNumberPattern(entry, canceller)
    } else if (entry.tagKind === 'F') {
        if (document) {
            return getFileLineNumber(document, sel)
        }
    }

    const lineNumber = Math.max(0, entry.address.lineNumber - 1)
    return Promise.resolve(new vscode.Selection(lineNumber, 0, lineNumber, 0))
}

function getLineNumberPattern(entry, canceller) {
    let matchWhole = false
    let pattern = entry.address.pattern
    if (pattern.startsWith("^")) {
        pattern = pattern.substring(1, pattern.length)
    } else {
        console.error(`ctagsx: Unsupported pattern ${pattern}`)
        return Promise.resolve(0)
    }

    if (pattern.endsWith("$")) {
        pattern = pattern.substring(0, pattern.length - 1)
        matchWhole = true
    }

    let lineNumber = 0
    let charPos = 0
    let found
    return eachLine(entry.file, line => {
        lineNumber += 1
        if ((matchWhole && line === pattern) || line.startsWith(pattern)) {
            found = true
            charPos = Math.max(line.indexOf(entry.name), 0)
            console.log(`ctagsx: Found '${pattern}' at ${lineNumber}:${charPos}`)
            return false
        } else if (canceller && canceller.isCancellationRequested) {
            console.log('ctagsx: Cancelled pattern searching')
            return false
        }
    })
        .then(() => {
            if (found) {
                return new vscode.Selection(lineNumber - 1, charPos, lineNumber - 1, charPos)
            }
        })
}

function getFileLineNumber(document, sel) {
    let pos = sel.end.translate(0, 1)
    let range = document.getWordRangeAtPosition(pos)
    if (range) {
        let text = document.getText(range)
        if (text.match(/[0-9]+/)) {
            const lineNumber = Math.max(0, parseInt(text, 10) - 1)
            let charPos = 0

            pos = range.end.translate(0, 1)
            range = document.getWordRangeAtPosition(pos)
            if (range) {
                text = document.getText(range)
                if (text.match(/[0-9]+/)) {
                    charPos = Math.max(0, parseInt(text) - 1)
                }
            }
            console.log(`ctagsx: Resolved file position to line ${lineNumber + 1}, char ${charPos + 1}`)
            return Promise.resolve(new vscode.Selection(lineNumber, charPos, lineNumber, charPos))
        }
    }
    return Promise.resolve()
}

function openAndReveal(context, editor, document, sel) {
    return vscode.workspace.openTextDocument(document).then(doc => {
        const showOptions = {
            viewColumn: editor ? editor.viewColumn : vscode.ViewColumn.One,
            preview: vscode.workspace.getConfiguration('ctagsx').get('openAsPreview'),
            selection: sel
        }
        return vscode.window.showTextDocument(doc, showOptions)
    })
}

module.exports = {
	activate,
	deactivate
}
