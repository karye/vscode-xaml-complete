import * as vscode from 'vscode';
import { XamlCompletionSettings, XmlSchemaPropertiesArray } from './types';
import XmlLinterProvider from './linterprovider';
import XmlCompletionItemProvider from './completionitemprovider';
import XmlFormatProvider from './formatprovider';
import XmlRangeFormatProvider from './rangeformatprovider';
import AutoCompletionProvider from './autocompletionprovider';
import XmlHoverProvider from './hoverprovider';
import XmlDefinitionProvider from './definitionprovider';
import XmlDefinitionContentProvider from './definitioncontentprovider';

export declare let globalSettings: XamlCompletionSettings;

export const languageId = 'xaml';

export const schemaId = 'xml2xsd-definition-provider';

export function activate(context: vscode.ExtensionContext): void {

    console.debug(`Activate XAMLCompletion`);

    vscode.workspace.onDidChangeConfiguration(loadConfiguration, undefined, context.subscriptions);
    loadConfiguration();

    // Status bar show extension is active
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    statusBarItem.text = 'XAML Completion';
    statusBarItem.tooltip = 'XAML Completion';
    statusBarItem.show();

    const schemaPropertiesArray = new XmlSchemaPropertiesArray();
    const completionitemprovider = vscode.languages.registerCompletionItemProvider(
        { language: languageId, scheme: 'file' },
        new XmlCompletionItemProvider(context, schemaPropertiesArray));

    const formatprovider = vscode.languages.registerDocumentFormattingEditProvider(
        { language: languageId, scheme: 'file' },
        new XmlFormatProvider(context, schemaPropertiesArray));

    const rangeformatprovider = vscode.languages.registerDocumentRangeFormattingEditProvider(
        { language: languageId, scheme: 'file' },
        new XmlRangeFormatProvider(context, schemaPropertiesArray));

    const hoverprovider = vscode.languages.registerHoverProvider(
        { language: languageId, scheme: 'file' },
        new XmlHoverProvider(context, schemaPropertiesArray));

    const definitionprovider = vscode.languages.registerDefinitionProvider(
        { language: languageId, scheme: 'file' },
        new XmlDefinitionProvider(context, schemaPropertiesArray));

    const linterprovider = new XmlLinterProvider(context, schemaPropertiesArray);

    const autocompletionprovider = new AutoCompletionProvider(context, schemaPropertiesArray);

    const definitioncontentprovider = vscode.workspace.registerTextDocumentContentProvider(schemaId, new XmlDefinitionContentProvider(context, schemaPropertiesArray));

    context.subscriptions.push(
        completionitemprovider,
        formatprovider,
        rangeformatprovider,
        hoverprovider,
        definitionprovider,
        linterprovider,
        autocompletionprovider,
        definitioncontentprovider);

    vscode.workspace.onDidOpenTextDocument((document) => {
        if (document.languageId === languageId) {
            console.log(`XAMLCompletion activated for ${document.uri.fsPath}`);
            statusBarItem.text = `XAML Completion: ${document.uri.fsPath}`;
        }
    });
}

function loadConfiguration(): void {
    const section = vscode.workspace.getConfiguration('XamlCompletion', null);
    globalSettings = new XamlCompletionSettings();
    globalSettings.xsdCachePattern = section.get('xsdCachePattern', undefined);
    globalSettings.schemaMapping = section.get('schemaMapping', []);
    globalSettings.formattingStyle = section.get('formattingStyle', "singleLineAttributes");
}

export function deactivate(): void {
    console.debug(`Deactivate XamlCompletion`);
}