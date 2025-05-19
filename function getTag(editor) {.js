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
    return go2definition(context, tag)
}