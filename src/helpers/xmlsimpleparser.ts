import { XmlTagCollection, XmlDiagnosticData, XmlScope, CompletionString } from '../types';

export default class XmlSimpleParser {

	public static getXmlDiagnosticData(xmlContent: string, xsdTags: XmlTagCollection, nsMap: Map<string, string>, strict: boolean = true): Promise<XmlDiagnosticData[]> {
		const sax = require("sax");
		const parser = sax.parser(true);

		return new Promise<XmlDiagnosticData[]>(
			(resolve) => {
				let result: XmlDiagnosticData[] = [];
				let nodeCache = new Map<string, CompletionString[]>();

				let getAttributes = (nodeName: string) => {

					if (!nodeCache.has(nodeName)) {
						nodeCache.set(nodeName, xsdTags.loadAttributesEx(nodeName, nsMap));
					}

					return nodeCache.get(nodeName);
				};

				parser.onerror = () => {
					if (undefined === result.find(e => e.line === parser.line)) {
						result.push({
							line: parser.line,
							column: parser.column,
							message: parser.error.message,
							severity: strict ? "error" : "warning"
						});
					}
					parser.resume();
				};

				parser.onopentag = (tagData: { name: string, isSelfClosing: boolean, attributes: Map<string, string> }) => {

					let nodeNameSplitted: Array<string> = tagData.name.split('.');

					if (xsdTags.loadTagEx(nodeNameSplitted[0], nsMap) !== undefined) {
						let schemaTagAttributes = getAttributes(nodeNameSplitted[0]) ?? [];
						nodeNameSplitted.shift();

						const xmlAllowed : Array<string> = [":schemaLocation", ":noNamespaceSchemaLocation", "xml:space"];
						Object.keys(tagData.attributes).concat(nodeNameSplitted).forEach((a: string) => {
							if (schemaTagAttributes.findIndex(sta => sta.name === a) < 0 && a.indexOf(":!") < 0
								&& a !== "xmlns" && !a.startsWith("xmlns:")
								&& xmlAllowed.findIndex(all => a.endsWith(all)) < 0) {
								result.push({
									line: parser.line,
									column: parser.column,
									message: `Unknown xml attribute '${a}' for tag '${tagData.name}'`, severity: strict ? "info" : "hint"
								});
							}
						});
					}
					else if (tagData.name.indexOf(":!") < 0) {
						result.push({
							line: parser.line,
							column: parser.column,
							message: `Unknown xml tag '${tagData.name}'`,
							severity: strict ? "info" : "hint"
						});
					}
				};

				parser.onend = () => {
					resolve(result);
				};

				parser.write(xmlContent).close();
			});
	}

	public static getSchemaXsdUris(xmlContent: string, documentUri: string, schemaMapping: { xmlns: string, xsdUri: string }[]): Promise<string[]> {
		const sax = require("sax");
		const parser = sax.parser(true);

		return new Promise<string[]>(
			(resolve) => {
				let result: string[] = [];

				if (documentUri.startsWith("git")) {
					resolve(result);
					return;
				}

				parser.onerror = () => {
					parser.resume();
				};

				let ensureAbsoluteUri = (u : string) =>
					(u.indexOf("/") > 0) ? u : documentUri.substring(0, documentUri.lastIndexOf("/") + 1) + u;

				parser.onattribute = (attr: any) => {
					if (attr.name.endsWith(":schemaLocation")) {
						let uris = attr.value.split(/\s+/).filter((v, i) => i % 2 === 1 || v.toLowerCase().endsWith(".xsd"));
						result.push(...uris.map(u => ensureAbsoluteUri(ensureAbsoluteUri(u))));
					} else if (attr.name.endsWith(":noNamespaceSchemaLocation")) {
						let uris = attr.value.split(/\s+/);
						result.push(...uris.map(u => ensureAbsoluteUri(ensureAbsoluteUri(u))));
					} else if (attr.name === "xmlns") {
						let newUriStrings = schemaMapping
							.filter(m => m.xmlns === attr.value)
							.map(m => m.xsdUri.split(/\s+/))
							.reduce((prev, next) => prev.concat(next), []);
						result.push(...newUriStrings);
					} else if (attr.name.startsWith("xmlns:")) {
						let newUriStrings = schemaMapping
							.filter(m => m.xmlns === attr.value)
							.map(m => m.xsdUri.split(/\s+/))
							.reduce((prev, next) => prev.concat(next), []);
						result.push(...newUriStrings);
					}
				};

				parser.onend = () => {
					resolve(result.filter((v, i, a) => a.indexOf(v) === i));
				};

				parser.write(xmlContent).close();
			});
	}

	public static getNamespaceMapping(xmlContent: string): Promise<Map<string, string>> {
		const sax = require("sax");
		const parser = sax.parser(true);

		return new Promise<Map<string, string>>(
			(resolve) => {
				let result: Map<string, string> = new Map<string, string>();

				parser.onerror = () => {
					parser.resume();
				};

				parser.onattribute = (attr: any) => {
					if (attr.name.startsWith("xmlns:")) {
						result.set(attr.value, attr.name.substring("xmlns:".length));
					}
				};

				parser.onend = () => {
					resolve(result);
				};

				parser.write(xmlContent).close();
			});
	}

	public static getScopeForPosition(xmlContent: string, offset: number): Promise<XmlScope> {
		const sax = require("sax");
		const parser = sax.parser(true);

		return new Promise<XmlScope>(
			(resolve) => {
				let result: XmlScope;
				let previousStartTagPosition = 0;
				let updatePosition = () => {

					if ((parser.position >= offset) && !result) {

						let content = xmlContent.substring(previousStartTagPosition, offset);
						content = content.lastIndexOf("<") >= 0 ? content.substring(content.lastIndexOf("<")) : content;

						let normalizedContent = content.concat(" ").replace("/", "").replace("\t", " ").replace("\n", " ").replace("\r", " ");
						let tagName = content.substring(1, normalizedContent.indexOf(" "));

						result = { tagName: /^[a-zA-Z0-9_:\.\-]*$/.test(tagName) ? tagName : undefined, context: undefined };

						if (content.lastIndexOf(">") >= content.lastIndexOf("<")) {
							result.context = "text";
						} else {
							let lastTagText = content.substring(content.lastIndexOf("<"));
							if (!/\s/.test(lastTagText)) {
								result.context = "element";
							} else if ((lastTagText.split(`"`).length % 2) !== 0) {
								result.context = "attribute";
							}
						}
					}

					previousStartTagPosition = parser.startTagPosition - 1;
				};

				parser.onerror = () => {
					parser.resume();
				};

				parser.ontext = (_t: any) => {
					updatePosition();
				};

				parser.onopentagstart = () => {
					updatePosition();
				};

				parser.onattribute = () => {
					updatePosition();
				};

				parser.onclosetag = () => {
					updatePosition();
				};

				parser.onend = () => {
					if (result === undefined) {
						result = { tagName: undefined, context: undefined };
					}
					resolve(result);
				};

				parser.write(xmlContent).close();
			});
	}

	public static checkXml(xmlContent: string): Promise<boolean> {
		const sax = require("sax");
		const parser = sax.parser(true);

		let result: boolean = true;
		return new Promise<boolean>(
			(resolve) => {
				parser.onerror = () => {
					result = false;
					parser.resume();
				};

				parser.onend = () => {
					resolve(result);
				};

				parser.write(xmlContent).close();
			});
	}

	public static formatXml(xmlContent: string, indentationString: string, eol: string, formattingStyle: "singleLineAttributes" | "multiLineAttributes" | "fileSizeOptimized"): Promise<string> {
		const sax = require("sax");
		const parser = sax.parser(true);

		let result: string[] = [];
		let xmlDepthPath: { tag: string, selfClosing: boolean, isTextContent: boolean }[] = [];

		let multiLineAttributes = formattingStyle === "multiLineAttributes";
		indentationString = (formattingStyle === "fileSizeOptimized") ? "" : indentationString;

		let getIndentation = (): string =>
			(!result[result.length - 1] || result[result.length - 1].indexOf("<") >= 0 || result[result.length - 1].indexOf(">") >= 0)
				? eol + Array(xmlDepthPath.length).fill(indentationString).join("")
				: "";

		let getEncodedText = (t: string) : string =>
			t.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&apos;');

		return new Promise<string>(
			(resolve) => {

				parser.onerror = () => {
					parser.resume();
				};

				parser.ontext = (t) => {
					result.push(/^\s*$/.test(t) ? `` : getEncodedText(`${t}`));
				};

				parser.ondoctype = (t) => {
					result.push(`${eol}<!DOCTYPE${t}>`);
				};

				parser.onprocessinginstruction = (instruction: { name: string, body: string }) => {
					result.push(`${eol}<?${instruction.name} ${instruction.body}?>`);
				};

				parser.onsgmldeclaration = (t) => {
					result.push(`${eol}<!${t}>`);
				};

				parser.onopentag = (tagData: { name: string, isSelfClosing: boolean, attributes: Map<string, string> }) => {
					let argString: string[] = [""];
					for (let arg in tagData.attributes) {
						argString.push(` ${arg}="${tagData.attributes[arg]}"`);
					}

					if (xmlDepthPath.length > 0) {
						xmlDepthPath[xmlDepthPath.length - 1].isTextContent = false;
					}

					let attributesStr = argString.join(multiLineAttributes ? `${getIndentation()}${indentationString}` : ``);
					result.push(`${getIndentation()}<${tagData.name}${attributesStr}${tagData.isSelfClosing ? "/>" : ">"}`);

					xmlDepthPath.push({
						tag: tagData.name,
						selfClosing: tagData.isSelfClosing,
						isTextContent: true
					});
				};

				parser.onclosetag = (t) => {
					let tag = xmlDepthPath.pop();

					if (tag && !tag.selfClosing) {
						result.push(tag.isTextContent ? `</${t}>` : `${getIndentation()}</${t}>`);
					}
				};

				parser.oncomment = (t) => {
					result.push(`<!--${t}-->`);
				};

				parser.onopencdata = () => {
					result.push(`${eol}<![CDATA[`);
				};

				parser.oncdata = (t) => {
					result.push(t);
				};

				parser.onclosecdata = () => {
					result.push(`]]>`);
				};

				parser.onend = () => {
					resolve(result.join(``));
				};
				parser.write(xmlContent).close();
			});
	}
}