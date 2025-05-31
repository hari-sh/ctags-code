const {getValueFromDb, getDB, batchWriteIntoDB} = require('./dbutils');
const vscode = require('vscode');
const fs = require('fs');
const readline = require('readline');
const path = require('path');

async function getPattern(filePath, name, canceller, pattern, matchWhole) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
    });
    let lineNumber = 0
    let charPos = 0
    let found = false
    for await (const line of rl) {
        lineNumber += 1
        if ((matchWhole && line === pattern) || line.startsWith(pattern)) {
            found = true
            charPos = Math.max(line.indexOf(name), 0)
            console.log(`ctags-code: Found '${pattern}' at ${lineNumber}:${charPos}`)
            return {retval:false, found, lineNumber, charPos}
        } else if (canceller && canceller.isCancellationRequested) {
            console.log('ctags-code: Cancelled pattern searching')
            return {retval:false, found, lineNumber, charPos}
        }
    }
}


async function getLineNumber(entry, document, sel, canceller) {
    if (entry.tagKind === 'F') {
        return await getFileLineNumber(document, sel)
    }
    else {
        return await getLineNumberPattern(entry, canceller)
    }
}

async function getLineNumberPattern(entry, canceller) {
    let matchWhole = false
    let pattern = entry.pattern
    if (pattern.startsWith("^")) {
        pattern = pattern.substring(1, pattern.length)
    } else {
        console.error(`ctags-code: Unsupported pattern ${pattern}`)
        return;
    }

    if (pattern.endsWith("$")) {
        pattern = pattern.substring(0, pattern.length - 1)
        matchWhole = true
    }
    console.log(pattern);
    const linedata = await getPattern(entry.file, entry.name, canceller, pattern, matchWhole);
    console.log(linedata);
    if (linedata.found) {
        return new vscode.Selection(linedata.lineNumber - 1, linedata.charPos, linedata.lineNumber - 1, linedata.charPos)
    }
}

async function getFileLineNumber(document, sel) {
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
            console.log(`ctags-code: Resolved file position to line ${lineNumber + 1}, char ${charPos + 1}`)
            return new vscode.Selection(lineNumber, charPos, lineNumber, charPos)
        }
    }
}

async function openAndReveal(context, editor, document, sel) {
    const doc = await vscode.workspace.openTextDocument(document);
    const showOptions = {
        viewColumn: editor ? editor.viewColumn : vscode.ViewColumn.One,
        selection: sel
    };
    return await vscode.window.showTextDocument(doc, showOptions);
}

async function revealCTags(context, editor, entry) {
    if (!entry) {
        return
    }
    const document = editor ? editor.document : null
    const triggeredSel = editor ? editor.selection : null;
    const sel = await getLineNumber(entry, document, triggeredSel);
    return openAndReveal(context, editor, entry.file, sel);
}

function getTag(editor) {
    const tag = editor.document.getText(editor.selection).trim()
    if (!tag) {
        const range = editor.document.getWordRangeAtPosition(editor.selection.active);
        if (range) {
            return editor.document.getText(range);
        }
    }
    return tag;
}

async function jumputil(editor, context, key) {
    if (!editor) return;
    if (!key) return;
    getValueFromDb(key).then(value => {
  if (value) {
    console.log('Found:', value);
    const options = [value].map(tag => {
                    if (!path.isAbsolute(tag.file)) {
                        tag.file = path.join(vscode.workspace.rootPath, tag.file)
                    }
                    tag.description = ""
                    tag.label = tag.file
                    tag.detail = tag.pattern
                    tag.lineNumber = 0
                    return tag
                });
        if (!options.length) {
            return vscode.window.showInformationMessage(`ctags-code: No tags found for ${tag}`)
        } else if (options.length === 1) {
            return revealCTags(context, editor, options[0])
        } else {
            return vscode.window.showQuickPick(options).then(opt => {
                return revealCTags(context, editor, opt)
            })
        }
  } else {
    console.log('Key not found');
  }
});
}

async function storeTagsToDB(tagsfile)    {
    const fileStream = fs.createReadStream(tagsfile);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    const db = getDB();

    const batchSize = 1000;
    let batchOps = [];

    for await (const line of rl) {
        if (line.startsWith('!')) continue;

        const parts = line.split('\t');
        if (parts.length < 3) continue;

        const [tagName, file, pattern, tagKind] = parts;
        const matches = [...pattern.matchAll(/\/(.*?)\//g)].map(m => m[1]);

        batchOps.push({
            type: 'put', 
            key: tagName, 
            value: {
                file,
                pattern: matches[0],
                tagKind
            }
        });

        if (batchOps.length >= batchSize) {
            await batchWriteIntoDB(batchOps);
            batchOps = [];
        }
    }

    if (batchOps.length > 0) {
        await batchWriteIntoDB(batchOps);
    }

    await db.close();
    await db.open();

    vscode.window.showInformationMessage('Tags are parsed');
}

module.exports = {jumputil ,getTag, storeTagsToDB};