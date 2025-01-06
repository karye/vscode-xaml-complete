import * as vscode from 'vscode';
import { languageId } from './extension';
import { XmlSchemaPropertiesArray } from './types';
import XmlSimpleParser from './helpers/xmlsimpleparser';

export default class AutoCompletionProvider implements vscode.Disposable {

    private documentListener: vscode.Disposable;
    private static maxLineChars = 1024;
    private static maxLines = 8096;
    private delayCount = 0;
    private documentEvent: vscode.TextDocumentChangeEvent;

    constructor(protected extensionContext: vscode.ExtensionContext, protected schemaPropertiesArray: XmlSchemaPropertiesArray) {
        this.documentListener = vscode.workspace.onDidChangeTextDocument(async (evnt) =>
            this.triggerDelayedAutoCompletion(evnt), this, this.extensionContext.subscriptions);
    }

    public dispose(): void {
        this.documentListener.dispose();
    }

    private async triggerDelayedAutoCompletion(documentEvent: vscode.TextDocumentChangeEvent, timeout = 250): Promise<void> {

        if (this.delayCount > 0) {
            this.delayCount = timeout;
            this.documentEvent = documentEvent;
            return;
        }
        this.delayCount = timeout;
        this.documentEvent = documentEvent;

        const tick = 100;

        while (this.delayCount > 0) {
            await new Promise(resolve => setTimeout(resolve, tick));
            this.delayCount -= tick;
        }

        this.triggerAutoCompletion(this.documentEvent);
    }

    private async triggerAutoCompletion(documentEvent: vscode.TextDocumentChangeEvent): Promise<void> {
        const activeTextEditor = vscode.window.activeTextEditor;
        const document = documentEvent.document;
        const inputChange = documentEvent.contentChanges[0];
        if (document.languageId !== languageId
            || documentEvent.contentChanges.length !== 1
            || !inputChange.range.isSingleLine
            || (inputChange.text && inputChange.text.indexOf("\n") >= 0)
            || activeTextEditor === undefined
            || document.lineCount > AutoCompletionProvider.maxLines
            || activeTextEditor.document.uri.toString() !== document.uri.toString()) {
            return;
        }

        const changeLine = inputChange.range.end.line;
        const wholeLineRange = document.lineAt(changeLine).range;
        const wholeLineText = document.getText(document.lineAt(inputChange.range.end.line).range);

        let linePosition = inputChange.range.start.character + inputChange.text.length;

        if (wholeLineText.length >= AutoCompletionProvider.maxLineChars) {
            return;
        }

        const scope = await XmlSimpleParser.getScopeForPosition(`${wholeLineText}\n`, linePosition);

        if (--linePosition < 0) {
            // NOTE: automatic actions require info about previous char
            return;
        }

        const before = wholeLineText.substring(0, linePosition);
        const after = wholeLineText.substring(linePosition);

        if (!(scope.context && scope.context !== "text" && scope.tagName)) {
            // NOTE: unknown scope
            return;
        }

        if (before.substr(before.lastIndexOf("<"), 2) === "</") {
            // NOTE: current position in closing tag
            return;
        }

        // NOTE: auto-change is available only for single tag enclosed in one line
        const closeCurrentTagIndex = after.indexOf(">");
        const nextTagStartPosition = after.indexOf("<");
        const nextTagEndingPosition = nextTagStartPosition >= 0 ? after.indexOf(">", nextTagStartPosition) : -1;
        const invalidTagStartPosition = nextTagEndingPosition >= 0 ? after.indexOf("<", nextTagEndingPosition) : -1;

        let resultText = "";

        if (after.substr(closeCurrentTagIndex - 1).startsWith(`/></${scope.tagName}>`) && closeCurrentTagIndex === 1) {
            resultText = wholeLineText.substring(0, linePosition + nextTagStartPosition) + `` + wholeLineText.substring(linePosition + nextTagEndingPosition + 1);
        } else if (after.substr(closeCurrentTagIndex - 1, 2) !== "/>" && invalidTagStartPosition < 0) {
            if (nextTagStartPosition >= 0 && after[nextTagStartPosition + 1] === "/") {
                resultText = wholeLineText.substring(0, linePosition + nextTagStartPosition) + `</${scope.tagName}>` + wholeLineText.substring(linePosition + nextTagEndingPosition + 1);
            } else if (nextTagStartPosition < 0) {
                resultText = wholeLineText.substring(0, linePosition + closeCurrentTagIndex + 1) + `</${scope.tagName}>` + wholeLineText.substring(linePosition + closeCurrentTagIndex + 1);
            }
        }

        if (!resultText || resultText.trim() === wholeLineText.trim()) {
            return;
        }

        resultText = resultText.trimRight();

        if (!await XmlSimpleParser.checkXml(`${resultText}`)) {
            // NOTE: Single line must be ok, one element in line
            return;
        }

        let documentContent = document.getText();

        documentContent = documentContent.split("\n")
            .map((l, i) => (i === changeLine) ? resultText : l)
            .join("\n");

        if (!await XmlSimpleParser.checkXml(documentContent)) {
            // NOTE: Check whole document
            return;
        }

        await activeTextEditor.edit((builder) => {
            builder.replace(
                new vscode.Range(
                    wholeLineRange.start,
                    wholeLineRange.end),
                resultText);
        }, { undoStopAfter: false, undoStopBefore: false });

        // Log the resultText to verify the auto-completion logic
        console.debug(`Auto-completed text: ${resultText}`);
    }
}