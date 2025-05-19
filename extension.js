const fs = require('fs');
const readline = require('readline');
const { Level }= require('level');
const vscode = require('vscode');
const path = require('path');
let db = null;
const lineReader = require('line-reader');
const Promise = require('bluebird');
const eachLine = Promise.promisify(lineReader.eachLine);

async function parseAndStoreTags() {
  const fileStream = fs.createReadStream(path.join(vscode.workspace.rootPath, 'tags'));
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (line.startsWith('!')) continue;

    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const [tagName, file, pattern, tagKind] = parts;
    const matches = [...pattern.matchAll(/\/(.*?)\//g)].map(m => m[1]);
    const value = {
      file,
      pattern: matches[0],
      tagKind
    };

    try {
      await db.put(tagName, value);
    } catch (err) {
      console.error(`Failed to store tag '${tagName}':`, err);
    }
  }
}


async function handleSearchTagsCommand(context) {
  const quickPick = vscode.window.createQuickPick();
  quickPick.placeholder = 'Search tags...';
  quickPick.matchOnDescription = true;

  quickPick.onDidChangeValue(async (input) => {
    if (!input) {
      quickPick.items = [];
      return;
    }

    const results = await getEntriesWithPrefix(input);
    quickPick.items = results.map(item => ({
      label: item.key,
      description: item.value.file,
    }));
  });

  
  quickPick.onDidAccept(() => {
    const selected = quickPick.selectedItems[0];
    if (selected) {
      go2definition(context, selected.label)
    }
    quickPick.hide();
  });

  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
}

async function getEntriesWithPrefix(prefix, limit = 10) {
  const entries = [];
  const iterator = db.iterator({
    gte: prefix,
    lte: prefix + '\xff',
    keyEncoding: 'utf8',
    valueEncoding: 'json'
  });

  try {
    for await (const [key, value] of iterator) {
      entries.push({ key, value });
      if (entries.length >= limit) break;
    }
  } catch (err) {
    console.error('Iterator error:', err);
    throw err;
  } finally {
    await iterator.close();
  }
  return entries;
}

async function getValueFromDb(key) {
  try {
    const value = await db.get(key);
    return value;
  } catch (err) {
    if (err.notFound) {
      return null;
    } else {
      throw err;
    }
  }
}

function go2definition(context, key)  {
  const editor = vscode.window.activeTextEditor
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
            return vscode.window.showInformationMessage(`ctagsx: No tags found for ${tag}`)
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


function getLineNumber(entry, document, sel, canceller) {
    if (entry.tagKind === 'F') {
        return getFileLineNumber(document, sel)
    }
    else {
        return getLineNumberPattern(entry, canceller)
    }
}

function getLineNumberPattern(entry, canceller) {
    let matchWhole = false
    let pattern = entry.pattern
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

async function openAndReveal(context, editor, document, sel) {
    const doc = await vscode.workspace.openTextDocument(document);
    const showOptions = {
        viewColumn: editor ? editor.viewColumn : vscode.ViewColumn.One,
        preview: vscode.workspace.getConfiguration('ctagsx').get('openAsPreview'),
        selection: sel
    };
    return await vscode.window.showTextDocument(doc, showOptions);
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

function jump2tag(context) {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
        console.log('ctagsx: Cannot search - no active editor')
        return
    }
    const tag = getTag(editor)
    if (!tag) {
        return
    }
    return go2definition(context, tag)
}

module.exports = {
  activate(context) {
    db = new Level(path.join(vscode.workspace.rootPath, 'tagsdb'), { valueEncoding: 'json' });
    context.subscriptions.push(vscode.commands.registerCommand('extension.storeTags', parseAndStoreTags));
    context.subscriptions.push(vscode.commands.registerCommand('extension.searchTags', handleSearchTagsCommand));
    context.subscriptions.push(vscode.commands.registerCommand('extension.jumpTag', jump2tag));
  },
  deactivate() {
    db.close();
  }
};