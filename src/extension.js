const vscode = require('vscode');
const path = require('path');
const {jumputil, getTag, storeTagsToDB} = require('./tagutils');
const {initDB, closeDB, getEntriesWithPrefix} = require('./dbutils');

async function parseAndStoreTags() {
    storeTagsToDB(path.join(vscode.workspace.rootPath, 'tags'));
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
      jumputil(vscode.window.activeTextEditor, context, selected.label)
    }
    quickPick.hide();
  });

  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
}

async function jump2tag(context) {
    const editor = vscode.window.activeTextEditor
    const tag = getTag(editor)
    return jumputil(editor, context, tag)
}

module.exports = {
  activate(context) {
    initDB();
    context.subscriptions.push(vscode.commands.registerCommand('extension.storeTags', parseAndStoreTags));
    context.subscriptions.push(vscode.commands.registerCommand('extension.searchTags', handleSearchTagsCommand));
    context.subscriptions.push(vscode.commands.registerCommand('extension.jumpTag', jump2tag));
  },
  deactivate() {
    closeDB();
  }
};