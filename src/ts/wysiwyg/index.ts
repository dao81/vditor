import {hidePanel} from "../toolbar/setToolbar";
import {uploadFiles} from "../upload";
import {isCtrl, isFirefox} from "../util/compatibility";
import {focusEvent, hotkeyEvent, scrollCenter, selectEvent} from "../util/editorCommonEvent";
import {isHeadingMD, isHrMD, paste, renderToc} from "../util/fixBrowserBehavior";
import {
    hasClosestBlock, hasClosestByAttribute,
    hasClosestByClassName, hasClosestByMatchTag,
} from "../util/hasClosest";
import {hasClosestByHeadings} from "../util/hasClosestByHEadings";
import {
    getEditorRange,
    getSelectPosition,
    setRangeByWbr,
} from "../util/selection";
import {afterRenderEvent} from "./afterRenderEvent";
import {genImagePopover, highlightToolbar} from "./highlightToolbar";
import {getRenderElementNextNode, modifyPre} from "./inlineTag";
import {input} from "./input";
import {showCode} from "./showCode";

class WYSIWYG {
    public element: HTMLPreElement;
    public popover: HTMLDivElement;
    public afterRenderTimeoutId: number;
    public hlToolbarTimeoutId: number;
    public preventInput: boolean;
    public composingLock: boolean = false;

    constructor(vditor: IVditor) {
        const divElement = document.createElement("div");
        divElement.className = "vditor-wysiwyg";

        divElement.innerHTML = `<pre class="vditor-reset" placeholder="${vditor.options.placeholder}"
 contenteditable="true" spellcheck="false"></pre>
<div class="vditor-panel vditor-panel--none"></div>`;

        this.element = divElement.firstElementChild as HTMLPreElement;

        this.popover = divElement.lastElementChild as HTMLDivElement;

        this.bindEvent(vditor);

        document.execCommand("DefaultParagraphSeparator", false, "p");

        focusEvent(vditor, this.element);
        hotkeyEvent(vditor, this.element);
        selectEvent(vditor, this.element);
    }

    private bindEvent(vditor: IVditor) {
        if (vditor.options.upload.url || vditor.options.upload.handler) {
            this.element.addEventListener("drop",
                (event: CustomEvent & { dataTransfer?: DataTransfer, target: HTMLElement }) => {
                    if (event.dataTransfer.types[0] !== "Files") {
                        return;
                    }
                    const files = event.dataTransfer.items;
                    if (files.length > 0) {
                        uploadFiles(vditor, files);
                    }
                    event.preventDefault();
                });
        }

        window.addEventListener("scroll", () => {
            hidePanel(vditor, ["hint", "headings", "emoji", "edit-mode"]);
            if (this.popover.style.display !== "block") {
                return;
            }
            const top = parseInt(this.popover.getAttribute("data-top"), 10);
            if (vditor.options.height !== "auto") {
                if (vditor.options.toolbarConfig.pin && vditor.toolbar.element.getBoundingClientRect().top === 0) {
                    this.popover.style.top = Math.max(window.scrollY - vditor.element.offsetTop - 8,
                        Math.min(top - vditor.wysiwyg.element.scrollTop, this.element.clientHeight - 21)) + "px";
                }
                return;
            } else if (!vditor.options.toolbarConfig.pin) {
                return;
            }
            this.popover.style.top = Math.max(top, (window.scrollY - vditor.element.offsetTop - 8)) + "px";
        });

        this.element.addEventListener("scroll", () => {
            hidePanel(vditor, ["hint", "headings", "emoji", "edit-mode"]);
            if (this.popover.style.display !== "block") {
                return;
            }
            const top = parseInt(this.popover.getAttribute("data-top"), 10) - vditor.wysiwyg.element.scrollTop;
            let max = -8;
            if (vditor.options.toolbarConfig.pin && vditor.toolbar.element.getBoundingClientRect().top === 0) {
                max = window.scrollY - vditor.element.offsetTop + max;
            }
            this.popover.style.top = Math.max(max, Math.min(top, this.element.clientHeight - 21)) + "px";
        });

        this.element.addEventListener("copy", (event: ClipboardEvent & { target: HTMLElement }) => {
            const range = getSelection().getRangeAt(0);
            if (range.toString() === "") {
                return;
            }
            event.stopPropagation();
            event.preventDefault();

            const codeElement = hasClosestByMatchTag(range.startContainer, "CODE");
            if (codeElement) {
                let codeText = "";
                if (codeElement.parentElement.tagName === "PRE") {
                    codeText = range.toString();
                } else {
                    codeText = "`" + range.toString() + "`";
                }
                event.clipboardData.setData("text/plain", codeText);
                event.clipboardData.setData("text/html", "");
                return;
            }

            const aElement = hasClosestByMatchTag(range.startContainer, "A");
            const aEndElement = hasClosestByMatchTag(range.endContainer, "A");
            if (aElement && aEndElement && aEndElement.isEqualNode(aElement)) {
                let aTitle = aElement.getAttribute("title") || "";
                if (aTitle) {
                    aTitle = ` "${aTitle}"`;
                }
                event.clipboardData.setData("text/plain",
                    `[${range.toString()}](${aElement.getAttribute("href")}${aTitle})`);
                event.clipboardData.setData("text/html", "");
                return;
            }

            const tempElement = document.createElement("div");
            tempElement.appendChild(range.cloneContents());

            event.clipboardData.setData("text/plain", vditor.lute.VditorDOM2Md(tempElement.innerHTML).trim());
            event.clipboardData.setData("text/html", "");
        });

        this.element.addEventListener("paste", (event: ClipboardEvent & { target: HTMLElement }) => {
            paste(vditor, event, {
                pasteCode: (code: string) => {
                    const range = getEditorRange(this.element);
                    const node = document.createElement("template");
                    node.innerHTML = code;
                    range.insertNode(node.content.cloneNode(true));
                    const blockElement = hasClosestByAttribute(range.startContainer, "data-block", "0");
                    if (blockElement) {
                        blockElement.outerHTML = vditor.lute.SpinVditorDOM(blockElement.outerHTML);
                    } else {
                        vditor.wysiwyg.element.innerHTML = vditor.lute.SpinVditorDOM(vditor.wysiwyg.element.innerHTML);
                    }
                    setRangeByWbr(vditor.wysiwyg.element, range);
                },
            });
        });

        // 中文处理
        this.element.addEventListener("compositionstart", (event: InputEvent) => {
            this.composingLock = true;
        });

        this.element.addEventListener("compositionend", (event: InputEvent) => {
            const headingElement = hasClosestByHeadings(getSelection().getRangeAt(0).startContainer);
            if (headingElement && headingElement.textContent === "") {
                // heading 为空删除 https://github.com/Vanessa219/vditor/issues/150
                renderToc(vditor);
                return;
            }
            input(vditor, getSelection().getRangeAt(0).cloneRange(), event);
        });

        this.element.addEventListener("input", (event: InputEvent) => {
            if (this.preventInput) {
                this.preventInput = false;
                return;
            }
            if (this.composingLock) {
                return;
            }
            const range = getSelection().getRangeAt(0);
            let blockElement = hasClosestBlock(range.startContainer);
            if (!blockElement) {
                // 没有被块元素包裹
                modifyPre(vditor, range);
                blockElement = hasClosestBlock(range.startContainer);
            }
            if (!blockElement) {
                return;
            }

            // 前后空格处理
            const startOffset = getSelectPosition(blockElement, range).start;

            // 开始可以输入空格
            let startSpace = true;
            for (let i = startOffset - 1; i > blockElement.textContent.substr(0, startOffset).lastIndexOf("\n"); i--) {
                if (blockElement.textContent.charAt(i) !== " " &&
                    // 多个 tab 前删除不形成代码块 https://github.com/Vanessa219/vditor/issues/162 1
                    blockElement.textContent.charAt(i) !== "\t") {
                    startSpace = false;
                    break;
                }
            }
            if (startOffset === 0) {
                startSpace = false;
            }

            // 结尾可以输入空格
            let endSpace = true;
            for (let i = startOffset - 1; i < blockElement.textContent.length; i++) {
                if (blockElement.textContent.charAt(i) !== " " && blockElement.textContent.charAt(i) !== "\n") {
                    endSpace = false;
                    break;
                }
            }

            const headingElement = hasClosestByHeadings(getSelection().getRangeAt(0).startContainer);
            if (headingElement && headingElement.textContent === "") {
                // heading 为空删除 https://github.com/Vanessa219/vditor/issues/150
                renderToc(vditor);
                return;
            }

            if (startSpace || endSpace || isHrMD(blockElement.innerHTML) || isHeadingMD(blockElement.innerHTML)) {
                return;
            }

            input(vditor, range, event);
        });

        this.element.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            if (event.target.tagName === "INPUT") {
                const checkElement = event.target as HTMLInputElement;
                if (checkElement.checked) {
                    checkElement.setAttribute("checked", "checked");
                } else {
                    checkElement.removeAttribute("checked");
                }
                this.preventInput = true;
                afterRenderEvent(vditor);
                return;
            }

            if (event.target.tagName === "IMG") {
                genImagePopover(event, vditor);
                return;
            }

            highlightToolbar(vditor);

            // 点击后光标落于预览区，需展开代码块
            let previewElement = hasClosestByClassName(event.target, "vditor-wysiwyg__preview");
            if (!previewElement) {
                previewElement = hasClosestByClassName(getEditorRange(this.element).startContainer, "vditor-wysiwyg__preview");
            }
            if (previewElement) {
                showCode(previewElement, vditor);
            }
        });

        this.element.addEventListener("keyup", (event: KeyboardEvent & { target: HTMLElement }) => {
            if (event.isComposing || isCtrl(event)) {
                return;
            }
            // 除 md 处理、cell 内换行、table 添加新行/列、代码块语言切换、block render 换行、跳出/逐层跳出 blockquote、h6 换行、
            // 任务列表换行、软换行外需在换行时调整文档位置
            if (event.key === "Enter") {
                scrollCenter(vditor);
            }
            if ((event.key === "Backspace" || event.key === "Delete") &&
                vditor.wysiwyg.element.innerHTML !== "" && vditor.wysiwyg.element.childNodes.length === 1 &&
                vditor.wysiwyg.element.firstElementChild && vditor.wysiwyg.element.firstElementChild.tagName === "P"
                && (vditor.wysiwyg.element.textContent === "" || vditor.wysiwyg.element.textContent === "\n")) {
                // 为空时显示 placeholder
                vditor.wysiwyg.element.innerHTML = "";
            }

            const range = getEditorRange(this.element);

            if (event.key === "Backspace") {
                // firefox headings https://github.com/Vanessa219/vditor/issues/211
                if (isFirefox() && range.startContainer.textContent === "\n" && range.startOffset === 1) {
                    range.startContainer.textContent = "";
                }
            }

            // 没有被块元素包裹
            modifyPre(vditor, range);

            highlightToolbar(vditor);

            if (event.key !== "ArrowDown" && event.key !== "ArrowRight" && event.key !== "Backspace"
                && event.key !== "ArrowLeft" && event.key !== "ArrowUp") {
                return;
            }

            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                vditor.hint.render(vditor);
            }

            // 上下左右，删除遇到块预览的处理
            let previewElement = hasClosestByClassName(range.startContainer, "vditor-wysiwyg__preview");
            if (!previewElement && range.startContainer.nodeType !== 3 && range.startOffset > 0) {
                // table 前删除遇到代码块
                const blockRenderElement = range.startContainer as HTMLElement;
                if (blockRenderElement.classList.contains("vditor-wysiwyg__block")) {
                    previewElement = blockRenderElement.lastElementChild as HTMLElement;
                }
            }
            if (!previewElement) {
                return;
            }
            const previousElement = previewElement.previousElementSibling as HTMLElement;
            if (previousElement.style.display === "none") {
                if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                    showCode(previewElement, vditor);
                } else {
                    showCode(previewElement, vditor, false);
                }
                return;
            }

            let codeElement = previewElement.previousElementSibling as HTMLElement;
            if (codeElement.tagName === "PRE") {
                codeElement = codeElement.firstElementChild as HTMLElement;
            }

            if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                const blockRenderElement = previewElement.parentElement;
                let nextNode = getRenderElementNextNode(blockRenderElement) as HTMLElement;
                if (nextNode && nextNode.nodeType !== 3) {
                    // 下一节点依旧为代码渲染块
                    const nextRenderElement = nextNode.querySelector(".vditor-wysiwyg__preview") as HTMLElement;
                    if (nextRenderElement) {
                        showCode(nextRenderElement, vditor);
                        return;
                    }
                }
                // 跳过渲染块，光标移动到下一个节点
                if (nextNode.nodeType === 3) {
                    // inline
                    while (nextNode.textContent.length === 0 && nextNode.nextSibling) {
                        // https://github.com/Vanessa219/vditor/issues/100 2
                        nextNode = nextNode.nextSibling as HTMLElement;
                    }
                    range.setStart(nextNode, 1);
                } else {
                    // block
                    range.setStart(nextNode.firstChild, 0);
                }
            } else {
                range.selectNodeContents(codeElement);
                range.collapse(false);
            }
        });
    }
}

export {WYSIWYG};
