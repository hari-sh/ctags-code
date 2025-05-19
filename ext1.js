const vscode = require('vscode');
const level = require('level');

const dbPath = '/absolute/path/to/tags-db';
let db;

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('extension.searchTags', handleSearchTagsCommand));
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

    const results = await searchTags(input);
    quickPick.items = results.map(item => ({
      label: item.tag,
      description: item.file,
      detail: item.pattern
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

function searchTags(prefix) {
  return new Promise((resolve, reject) => {
    const results = [];

    db.createReadStream({
      gte: prefix,
      lte: prefix + '\xff',
      limit: 50
    })
      .on('data', ({ key, value }) => {
        results.push({ tag: key, file: value.file, pattern: value.pattern });
      })
      .on('error', reject)
      .on('end', () => resolve(results));
  });
}

function deactivate() {
  if (db && db.isOpen()) {
    db.close();
  }
}

module.exports = {
  activate,
  deactivate
};
