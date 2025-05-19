const fs = require('fs');
const readline = require('readline');
const level = require('level');
const vscode = require('vscode');
const path = require('path');
let db = null;

async function parseAndStoreTags() {
  const fileStream = fs.createReadStream(path.join(vscode.workspace.rootPath, 'tags'));
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (line.startsWith('!')) continue;

    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const [tagName, file, pattern] = parts;

    const value = {
      file,
      pattern
    };

    try {
      await db.put(tagName, value);
    } catch (err) {
      console.error(`Failed to store tag '${tagName}':`, err);
    }
  }
}

async function storeAndReadKeys(dbPath, data) {
  try {
    const keys = [];
    for await (const key of db.keys()) {
      keys.push(key);
    }
    return keys;
  } catch (err) {
    console.error('Error:', err);
  }
}


function printAllTags()
{
  storeAndReadKeys().then(keys => {
  console.log('All keys:', keys);
});
}

async function handleSearchTagsCommand() {
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
      detail: item.key
    }));
  });

  
  quickPick.onDidAccept(() => {
    const selected = quickPick.selectedItems[0];
    if (selected) {
      vscode.window.showInformationMessage(`Selected tag: ${selected.label}`);
    }
    quickPick.hide();
  });

  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
}

async function getEntriesWithPrefix(prefix, limit = 10) {
    const entries = [];
    let stream;

    try {
        stream = db.createReadStream({
            gte: prefix,
            lte: prefix + '\xff',
            limit: limit,
            keys: true,
            values: true
        });

        await new Promise((resolve, reject) => {
            stream.on('data', (data) => {
                try {
                    entries.push({
                        key: data.key,
                        value: data.value
                    });
                } catch (parseError) {
                    console.error('Error parsing entry:', parseError);
                    // Continue with next entry instead of failing
                }
            });

            stream.on('error', (err) => {
                console.error('Stream error:', err);
                reject(err);
            });

            stream.on('end', () => {
                console.log(`Stream ended successfully. Found ${entries.length} entries.`);
                resolve();
            });

            stream.on('close', () => {
                console.log('Stream closed');
            });
        });

        return entries;
    } catch (err) {
        console.error('Error in getEntriesWithPrefix:', err);
        throw err; // Re-throw after logging
    } finally {
        if (stream) {
            stream.destroy(); // Clean up stream if it exists
        }
    }
}

module.exports = {
  activate(context) {
    db = level(path.join(vscode.workspace.rootPath, 'tagsdb'), { valueEncoding: 'json' });
    context.subscriptions.push(vscode.commands.registerCommand('extension.storeTags', parseAndStoreTags));
    context.subscriptions.push(vscode.commands.registerCommand('extension.printTags', printAllTags));
    context.subscriptions.push(vscode.commands.registerCommand('extension.searchTags', handleSearchTagsCommand));
  },
  deactivate() {
    db.close();
  }
};