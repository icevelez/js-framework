/** @typedef {{ children : number[][], text_funcs : { child_index : number, expr : string }[], attr_funcs : { child_index : number, expr : string, property : string }[], bindings : { child_index : number, var : string, property : string, event_name : string }[], events : { child_index : number, event_name : string, expr : string }[], blocks : { child_index : number, type : string, id : string }[], core_component_blocks : { child_index : number, component_name : string, props_id : string }, component_blocks : { child_index : number, component_tag : string, props_id : string }, use_directives : { child_index : number, func_name : string, expr : string }[] slot_child_index : number  }} Instruction */

/** @typedef {(props:Record<string, any>) => (() => void)} CoreComponent the function that wraps both the data and render function */

/** @typedef {{ fns : string[], exprs : string[] }} IfBlock */
/** @typedef {{ fn : string, empty_fn : string, expr : string, key : string, keys?: string[], index_key?:string }} EachBlock */
/** @typedef {{ pending_fn:string, then_fn?: string, then_key?:string, catch_fn?: string, catch_key?:string, expr : string }} AwaitBlock */
/** @typedef {{ props : Record<string, string>, dynamic_props : { key:string, expr : string }[] }} PropsBlock */
/** @typedef {Record<string, CoreComponent>} ComponentBlock */

/** @typedef {IfBlock | EachBlock | AwaitBlock | PropsBlock | CoreComponent} BlockCache */

/** @type {any | null} */
let arg_global = null;

const CORE = {
    version: "0.5.0",
    show_anchor_blocks : true, // flag to use comment node instead of text node as anchor, good for debugging
    PRP_STATE: Symbol(),
    MOUNT_FNS: Symbol(),
    DESTROY_FNS: Symbol(),
    run_mount_fns,
    run_destroy_fns,
    effect,
    set_new_context,
    create_new_context,
    /** @type {DocumentFragment[]} */
    fragment_cache: [],
    /** @type {Map<string, BlockCache[]>} */
    block_cache: new Map(),
    /** @type {Map<string, WeakMap<Node, Set<Function>>>} */
    delegated_events: new Map(),
    /**
     * Converts string to Document Fragment
     * @param {string} html_string
     */
    html: function (html_string) {
        const template = document.createElement("template");
        template.innerHTML = html_string;
        return template.content;
    },
    /**
     * @param {Node} node
     * @param {string} text
     */
    set_text: function (node, text) {
        if (node.__cacheText === text) return;
        node.__cacheText = node.nodeValue = text;
    },
    get_param_args: function () {
        const args = arg_global;
        arg_global = null;
        return args;
    },
    set_param_args: function (...args) {
        arg_global = args;
    },
    /**
     * @param {Node} node
     * @param {any} value
     * @param {string} property
     */
    set_attr: function (node, value, property) {
        if (!node.__cacheAttr) node.__cacheAttr = {};
        if (node.__cacheAttr[property] === value) return;
        node.__cacheAttr[property] = value;

        if (property === "value") {
            node.value = value;
        } else if (property === "checked") {
            node.checked = value === "true" || value === true;
            node.setAttribute(property, node.checked ? "" : value);
        } else if (value === "false" || !value) {
            node.removeAttribute(property);
        } else {
            node.setAttribute(property, value === "true" ? "" : value);
        }
    },
    /**
     * @param {string} event_name
     * @param {Node} node
     * @param {Function} func
     * @returns {() => void} remove event
     */
    delegate: function (event_name, node, func) {
        if (typeof func !== "function") throw new Error("func is not a function");
        let event_node_weakmap = CORE.delegated_events.get(event_name);

        if (!event_node_weakmap) {
            event_node_weakmap = new WeakMap();
            const funcs = new Set();
            funcs.add(func);

            event_node_weakmap.set(node, funcs);
            CORE.delegated_events.set(event_name, event_node_weakmap);

            window.addEventListener(event_name, (e) => match_delegated_node(event_node_weakmap, e, e.target));

            return () => funcs.delete(func);
        }

        let funcs = event_node_weakmap.get(node);
        if (!funcs) {
            funcs = new Set();
            event_node_weakmap.set(node, funcs);
        }

        funcs.add(func);
        return () => funcs.delete(func);
    },
    /**
     * @param {Node} startNode
     * @param {Node} endNode
     */
    remove_nodes: function (parentNode, startNode, endNode) {
        if (!parentNode) throw "parent node not found";

        if (startNode === endNode) {
            parentNode.removeChild(startNode);
            return;
        }

        let node = startNode;
        while (node && node !== endNode) {
            const next = node.nextSibling;
            parentNode.removeChild(node);
            node = next;
        }

        parentNode.removeChild(endNode);
    },
    /**
     * Returns a function to dispose DOM nodes and reactive bindings
     * @param {Node} anchor
     * @param {(($:any) => Boolean)[]} condition_fns
     * @param {(() => (() => void))[]} template_fns
     */
    if: function (anchor, condition_fns, template_fns) {
        const fragment = document.createDocumentFragment();
        const fns = template_fns;

        let prev_fn
        let dispose;

        const effect_dispose = CORE.effect(() => {
            let curr_fn;

            for (let i = 0; i < condition_fns.length; i++) {
                if (!condition_fns[i]()) continue;
                curr_fn = fns[i];
                break;
            }

            if (prev_fn === curr_fn) return;
            prev_fn = curr_fn;

            if (dispose) dispose();
            if (!curr_fn) return;

            try {
                CORE.set_param_args(fragment);
                dispose = curr_fn();
                anchor.before(fragment);
            } catch (error) {
                console.trace(error);
            }
        }, { track_inner_effect: false })

        return () => {
            dispose();
            effect_dispose();
        }
    },
    /**
     * Returns a function to dispose DOM nodes and reactive bindings
     * @param {Node} anchor
     * @param {() => any[]} arr_fn
     * @param {() => (() => void)} then_fn
     * @param {() => (() => void)} else_fn
     */
    each: function (anchor, arr_fn, then_fn, else_fn) {
        let else_block_dispose_fn = null;
        let existing_dispose_blocks = [];

        const fragment = document.createDocumentFragment();
        const start_node = CORE.show_anchor_blocks ? new Comment("each-block-start") : new Text("");
        anchor.before(start_node);

        const effect_dispose = CORE.effect(() => {
            try {
                const arr = arr_fn();

                if (!arr || arr?.length <= 0) {
                    if (existing_dispose_blocks.length > 0) {
                        const parent_node = anchor.parentNode;
                        CORE.remove_nodes(parent_node, start_node.nextSibling, anchor.previousSibling);
                    }

                    for (const dispose of existing_dispose_blocks) dispose();
                    existing_dispose_blocks.length = 0;

                    if (!else_fn || else_block_dispose_fn) return;
                    CORE.set_param_args(fragment);
                    else_block_dispose_fn = each_block.else_fn();
                    anchor.before(fragment);
                    return;
                }

                if (else_block_dispose_fn) {
                    else_block_dispose_fn()
                    else_block_dispose_fn = null;
                }

                const new_each_dispose_blocks = [];

                const is_array = Array.isArray(arr);
                const is_map_or_set = arr instanceof Map || arr instanceof Set;

                let i = -1;
                for (const ar of arr) {
                    i++;

                    if (existing_dispose_blocks[i]) {
                        new_each_dispose_blocks.push(existing_dispose_blocks[i]);
                        continue;
                    }

                    CORE.set_param_args(fragment);
                    const index = i; // snapshot of i
                    const dispose = then_fn(is_array ? (() => arr[index]) : is_map_or_set ? (() => arr.get(ar)) : () => ar, index);
                    new_each_dispose_blocks.push(dispose);
                }

                // TEAR DOWN BLOCKS THAT ARE BEYOND THE NEW ARRAY LENGTH
                for (let i = new_each_dispose_blocks.length; i < existing_dispose_blocks.length; i++) {
                    existing_dispose_blocks[i]();
                }

                if (new_each_dispose_blocks.length > 0) anchor.before(fragment);

                existing_dispose_blocks = new_each_dispose_blocks;
            } catch (error) {
                console.trace(error);
            }
        }, { track_inner_effect: false })

        return () => {
            if (else_block_dispose_fn) else_block_dispose_fn();
            else_block_dispose_fn = null;
            for (const dispose of existing_dispose_blocks) dispose();
            existing_dispose_blocks.length = 0;
            effect_dispose();
        }
    },
    /**
     * Returns a function to dispose DOM nodes and reactive bindings
     * @param {Node} anchor
     * @param {() => Promise<any>} await_fn
     * @param {() => (() => void)} pending_fn
     * @param {() => ((value:any) => void)} then_fn
     * @param {() => (() => void)} catch_fn
     */
    await: function (anchor, await_fn, pending_fn, then_fn, catch_fn) {
        let pending_dispose_fn;
        let dispose_fn;
        let last_id;

        const dispose = () => {
            if (pending_dispose_fn) {
                pending_dispose_fn();
                pending_dispose_fn = null;
            }

            if (dispose_fn) {
                dispose_fn();
                dispose_fn = null;
            }
        }

        const fragment = document.createDocumentFragment();
        const context = create_new_context();

        const effect_dispose = CORE.effect(() => {
            const promise = new Promise(async (resolve) => { try { resolve([await await_fn(), null]) } catch (error) { resolve([null, error]); } });
            const curr_id = Math.random();
            last_id = curr_id;

            if (!(promise instanceof Promise)) {
                CORE.set_param_args(fragment);
                dispose_fn = then_fn(promise);
                anchor.before(fragment);
                return dispose_fn;
            }

            CORE.set_param_args(fragment);
            pending_dispose_fn = pending_fn();
            anchor.before(fragment);

            promise.then(([value, error]) => {
                if (last_id !== curr_id) return;

                // const old_context = set_new_context(context);
                CORE.set_param_args(fragment);
                dispose_fn = (error ? catch_fn : then_fn)(error ? error : value);
                // set_new_context(old_context);

                pending_dispose_fn();
                pending_dispose_fn = null;
                anchor.before(fragment);
            })

            return dispose;
        }, { track_inner_effect: false });

        return () => {
            dispose_fn();
            effect_dispose();
            set_new_context(context);
        }
    },
    /**
     * Returns a function to dispose DOM nodes and reactive bindings
     * @param {Node} anchor
     * @param {Function | { default : Function }} fn
     * @param {any} props
     * @param {Function} slot_fn
     */
    core_component: function (anchor, fn, props, slot_fn) {
        const fragment = document.createDocumentFragment();
        CORE.set_param_args(fragment, slot_fn);
        const dispose = (fn.default ? fn.default : fn)(props);
        anchor.before(fragment);
        return dispose;
    },
    resolve_components: async function (component_promises, id) {
        const keys = Object.keys(component_promises || {});
        const arr = await Promise.all(keys.map((k) => component_promises[k]));
        const components = {};
        for (let i = 0; i < keys.length; i++) components[keys[i]] = arr[i];
        if (keys.length > 0) add_block_to_cache(id, components);
    }
}

/**
 * @param {WeakMap<Node, Set<Function>>} map
 * @param {Event} event
 * @param {Node} target
 */
function match_delegated_node(map, event, target) {
    const fns = map.get(target);
    if (!fns) return target.parentNode ? match_delegated_node(map, event, target.parentNode) : undefined;
    for (const fn of fns) fn(event);
}

/**
 * @param {Node} node
 * @param {string} text
 */
function replace_node_with_anchor(node, text) {
    const anchor = CORE.show_anchor_blocks ? new Comment(text) : new Text("");
    node.parentNode.replaceChild(anchor, node);
}

/**
 * @param {Node} node
 * @param {number[]} node_index
 * @param {Instruction} instruction
 */
function discover_node_instruction(node, node_index = [], instruction = { children: [], events: [], bindings: [], attr_funcs: [], text_funcs: [], blocks: [], core_component_blocks: [], component_blocks: [], use_directives: [], slot_child_index: -1 }) {
    const isStyle = node instanceof HTMLStyleElement;
    if (isStyle) return instruction;

    const handlebar_re = /({{(?:(?!}}).)*}})/g;
    const handlebar_capture_inner_expression_re = /{{\s*(.+?)\s*}}/g;

    const isText = node.nodeType === Node.TEXT_NODE;
    if (isText) {
        const expression = node.textContent;
        const parts = expression.split(handlebar_re);
        const has_handlebars = parts.map(p => p.startsWith("{{")).filter(p => p === true).length > 0;
        if (!has_handlebars) return instruction;

        node.textContent = " "; // DO NOT REMOVE THIS WHITESPACE. IT IS FOR A TEXT NODE
        instruction.children.push(node_index);
        instruction.text_funcs.push({ child_index: instruction.children.length - 1, expr: `\`${expression.replace(handlebar_capture_inner_expression_re, (_, e) => "${" + e + "}")}\`` });
        return instruction;
    }

    if (node.nodeType === Node.COMMENT_NODE) return instruction;

    const isCoreSlotNode = (node) => Boolean(node.dataset && node.dataset.block === "core-slot");
    if (isCoreSlotNode(node)) {
        replace_node_with_anchor(node, "component-slot");
        instruction.children.push(node_index);
        instruction.slot_child_index = instruction.children.length - 1;
        return instruction;
    }

    const isComponentNode = (node) => Boolean(node.dataset && node.dataset.block === "component");
    const isCoreComponentNode = (node) => Boolean(node.dataset && node.dataset.block === "core-component");

    const is_component_node = isComponentNode(node);
    const is_core_component_node = isCoreComponentNode(node);
    if (is_component_node || is_core_component_node) {
        const component = node.dataset.component || null;
        const component_tag = node.dataset.componentTag || null;
        if (is_core_component_node && !component) throw "no default component found";
        if (is_component_node && !component_tag) throw "component not found";
        replace_node_with_anchor(node, "component-block");
        instruction.children.push(node_index);
        instruction.component_blocks.push({ child_index: instruction.children.length - 1, component, component_tag, props_id: node.dataset.blockPropsId, slot_id: node.dataset.slotId });
        return instruction;
    }

    const isBlockNode = (node) => Boolean(node.dataset && node.dataset.block && node.dataset.blockId)
    if (isBlockNode(node)) {
        replace_node_with_anchor(node, node.dataset.block + "-block");
        instruction.children.push(node_index);
        instruction.blocks.push({ child_index: instruction.children.length - 1, type: node.dataset.block, id: node.dataset.blockId });
        return instruction;
    }

    if (node.attributes) {
        for (const attr of Array.from(node.attributes)) {
            const attrName = attr.name.toLowerCase();
            const attrVal = attr.value.trim();
            if (attrName.startsWith('use:')) {
                const expr = attrVal;
                const func_name = attrName.slice(4);
                if (!instruction.children.includes(node_index)) instruction.children.push(node_index);
                instruction.use_directives.push({ child_index: instruction.children.length - 1, func_name, expr });

                node.removeAttribute(attrName);
            } else if (attrName.startsWith('on:')) {
                const expr = attrVal;
                const event_name = attrName.slice(3);

                if (!instruction.children.includes(node_index)) instruction.children.push(node_index);
                instruction.events.push({ child_index: instruction.children.length - 1, event_name, expr });

                node.removeAttribute(attrName);
            } else if (attrName.startsWith(":")) {
                const expr = attrVal;
                if (!instruction.children.includes(node_index)) instruction.children.push(node_index);
                instruction.attr_funcs.push({ child_index: instruction.children.length - 1, expr, property: attrName.slice(1, attrName.length) });

                node.removeAttribute(attrName);
            }
        };
    }

    const childNodes = Array.from(node.childNodes);
    for (let i = 0; i < childNodes.length; i++) discover_node_instruction(childNodes[i], [...node_index, i], instruction);

    return instruction;
}

/** @type {(nums:number[]) => string} */
const resolve_child_node = (nums = []) => `.childNodes[${nums.shift() || 0}]` + ((nums.length <= 0) ? '' : resolve_child_node(nums));

/** @type {(key:string, block:BlockCache) => void} */
export const add_block_to_cache = (key, block) => { CORE.block_cache.set(key, block) };

/**
 * @param {Node} root
 */
function remove_whitespace_nodes(root) {
    let child = root.firstChild;

    while (child) {
        const next = child.nextSibling;

        if (child.nodeName !== "PRE" && child.nodeName !== "TEXTAREA" && (child.nodeType === Node.ELEMENT_NODE || child.nodeType === Node.DOCUMENT_FRAGMENT_NODE))
            remove_whitespace_nodes(child);
        else if (child.nodeType === Node.TEXT_NODE)
            if (child.textContent.trim() === "") child.remove();
            else child.textContent = child.textContent.trim().replaceAll("\n", "").replaceAll("\t", "")

        child = next;
    }
}

/**
* Replaces all custom HTML Tags with a placeholder element to be processed as components
* @param {string} template
* @param {Function} template_processor
*/
export function process_components(template, template_processor) {
    return template.replace(/<([A-Z][A-Za-z0-9]*)\s*((?:[^>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>(?:([\s\S]*?)<\/\1>)?/g, (match, tag, attrStr, _, inner_content) => {
        const props = {}, dynamic_props = [], props_id = `props-${make_id(8)}`, slot_id = `slot-${make_id(8)}`;

        attrStr.replace(/([\w:@-]+)(?:\s*=\s*"([^"]*)")?/g, (_, key, value) => {
            if (key.startsWith(":")) {
                if (value) dynamic_props.push({ key: key.slice(1, key.length), expr: value });
            } else if (value) {
                props[key] = value;
            }
        })

        if (inner_content) add_block_to_cache(slot_id, create_render_code_string(template_processor(inner_content)));
        add_block_to_cache(props_id, { props, dynamic_props });

        if (match.startsWith("<CoreSlot")) return `<template data-block="core-slot"></template>`;
        if (match.startsWith("<CoreComponent")) {
            const _default = props.default;
            delete props.default;
            return `<template data-block="core-component" data-block-props-id="${props_id}" data-component="${_default}" ${slot_id ? `data-slot-id="${slot_id}"` : ''}></template>`;
        }

        return `<template data-block="component" data-component-tag="${tag}" data-block-props-id="${props_id}" ${slot_id ? `data-slot-id="${slot_id}"` : ''}></template>`;
    })
}

/**
 * Extracts the contents of "export default function() { .... }"
 * @param {string} source
 */
function extract_default_function(source) {
    const match = /export\s+default\s+function(?:\s+\w+)?\s*\(/.exec(source);
    if (!match) return null;

    let i = source.indexOf("{", match.index);
    if (i === -1) return null;

    const start = i;
    let depth = 1;

    while (++i < source.length) {
        const ch = source[i];

        if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) return source.slice(start + 1, i);
        }
    }

    return null;
}

/**
 * @param {string} url
 * @param {DocumentFragment} template_processor
 */
export async function sfc(url, template_processor) {
    const core_assist = window.__core_assist__;
    if (core_assist && await core_assist.has_cache(url)) return core_assist.use_cache(url);

    const response = await fetch(url);
    const text = await response.text();
    if (!response.ok) throw text;

    const base = document.createElement("template");
    base.innerHTML = text;

    const scriptEl = base.content.querySelector("script");
    const script = scriptEl?.innerHTML || "";
    const template = text.replace(scriptEl?.outerHTML, "");
    const response_url = response.url;
    const etag = response.headers.get("etag") || "";

    if (!script) return new Function(create_render_code_string(template, { include_context : true }));

    const href = window.location.href.split("#")[0] + url.substring(0, url.lastIndexOf("/") + 1);
    let code = `//# sourceURL=${url.split("/").at(-1)}${script}`.replaceAll(/from\s+["']([^"']+\.js)["']/g, (expr, match) => match.startsWith("http") || match.startsWith("data:") ? expr : expr.replace(match, `${href}${match}`));

    const components_id = `component-${make_id(6)}`;
    const css_scope_id = `core-${make_id(6).toLowerCase()}`;

    const render_code_string = create_render_code_string(template_processor(process_components(template, template_processor)), { css_scope_id, components_id, include_context : true, include_lifecycle : true });
    const user_code = extract_default_function(code);
    code = code.replace(user_code, `${user_code}\n\t\t/* END OF USER CODE - CODE BELOW IS INJECTED BY THE RUNTIME COMPILER - IT REPRESENTS YOUR TEMPLATE */\n\t\t${render_code_string}`);

    const template_initialization_code = `
    export const $COMPONENT_ID = "${components_id}";
    const $CORE = window.__core__;\n\t${
    CORE.fragment_cache.map((frag, i) => {
        inject_scope_id_to_children(frag, css_scope_id);
        const template = document.createElement("template");
        template.content.append(frag);
        return `const $FRAGMENT_CACHE_${i} = $CORE.html(${JSON.stringify(template.innerHTML)})`;
    }).join("\n\t")}`;

    code = `${code}${template_initialization_code}`;

    CORE.fragment_cache.length = 0;

    if (core_assist) core_assist.set_cache(response_url, etag, code, text);

    const script_blob = new Blob([code], { type: 'text/javascript' });
    const script_url = URL.createObjectURL(script_blob);

    const { default: render_function, ...component_promises } = await import(script_url);

    await CORE.resolve_components(component_promises, components_id);

    return render_function
}

/**
 *
 * @param {DocumentFragment} fragment
 * @param {{ css_scope_id?: string, components_id?: number, include_lifecycle: boolean, include_context : boolean }} options
 */
export function create_render_code_string(fragment, options) {
    if (typeof fragment === "string") {
        const templateEl = document.createElement("template");
        templateEl.innerHTML = fragment;
        fragment = templateEl.content;
    }

    remove_whitespace_nodes(fragment) // this should be executed before processing any template to prevent empty text nodes that are used as anchor points for rendering to be mistakenly removed

    let dispose_fn_i = -1;

    const style_sheet = options?.css_scope_id ? apply_scope_css(fragment, options?.css_scope_id) : "";
    const instruction = discover_node_instruction(fragment);
    const fragment_cache_index = CORE.fragment_cache.length;
    CORE.fragment_cache.push(fragment);

    const render_code_string = `
        const $CORE = window.__core__;
        const [$ANCHOR, $SLOT_FN] = $CORE.get_param_args();
        const $TEMPLATE = $FRAGMENT_CACHE_${fragment_cache_index}.cloneNode(true);

        const $NODE_START = $TEMPLATE.firstChild;
        const $NODE_END = $TEMPLATE.lastChild;
${
        style_sheet ? `\n\t\tconst $STYLE = document.createElement("style");
        $STYLE.innerHTML = \`${style_sheet}\`;
        document.head.append($STYLE);\n` : ''
}${
    options?.include_context ? `
        const $CONTEXT = $CORE.create_new_context();
        const $OLD_CONTEXT = $CORE.set_new_context($CONTEXT);\n\n` : '\n'
}${
        (instruction.children.length > 0 ? '\t\t// DECLARE NODES WITH BINDINGS\n\t' : '') +
            instruction.children.map((child, i) => {
                return `\tconst $CHILD${i} = $TEMPLATE${resolve_child_node(child)};`;
            }).join("\n\t")
}

        const $DISPOSE_FNS = [];
${
    (options?.components_id ? `\n\t\tconst $COMPONENTS = $CORE.block_cache.get("${options.components_id}")` : '')
}${
        (instruction.text_funcs.length > 0 || instruction.attr_funcs.length > 0) ? `
        // TEXT & ATTRIBUTES
        $DISPOSE_FNS[${++dispose_fn_i}] = $CORE.effect(() => {
            ${instruction.text_funcs.map((func) => {
                return `$CORE.set_text($CHILD${func.child_index}, ${func.expr});`
            }).join("\n\t\t\t")}${(instruction.attr_funcs.length > 0 ? "\n\t\t\t" : "") +
                instruction.attr_funcs.map((func, i) => {
                    return `$CORE.set_attr($CHILD${func.child_index}, ${func.expr}, "${func.property}");`
                }).join("\n\t\t")}
        })` : ''
}${
        (instruction.events.length > 0 ? '\n\n\t\t// EVENT DELEGATION\n\t\t' : '') +
        instruction.events.map((event) => {
            return `$DISPOSE_FNS[${++dispose_fn_i}] = $CORE.delegate("${event.event_name}", $CHILD${event.child_index}, (${event.expr}));`
        }).join("\n\t\t")
}${
        (instruction.blocks.length > 0 ? '\n\n\t\t// IF/EACH/AWAIT BLOCKS\n\t\t' : '') +
        instruction.blocks.sort((a,b) => a.type.localeCompare(b.type)).map((block) => {
            const block_data = CORE.block_cache.get(block.id);
            const each_fn = (fn) => `(${block_data.key}${block_data.index_key ? `, ${block_data.index_key}` : ''}) => {${fn.replaceAll("\n", "\n\t")}}`;
            const await_fn = (fn, key = "") => fn ? `(${key}) => {${fn.replaceAll("\n", "\n\t")}}` : 'null';
            if (block.type === "if") {
                return `$DISPOSE_FNS[${++dispose_fn_i}] = $CORE.if($CHILD${block.child_index}, [\n\t\t\t${block_data.exprs.map((expr) => `(() => ${expr})`).join(",\n\t\t\t")}\n\t\t], [\n\t\t${block_data.fns.map((fn) => `() => {${fn.replaceAll("\n", "\n\t")}}`).join(",\n\t\t")}\n\t\t]);`
            } else if (block.type === "each") {
                return `$DISPOSE_FNS[${++dispose_fn_i}] = $CORE.each($CHILD${block.child_index}, (() => ${block_data.expr}), ${each_fn(block_data.fn)}${block_data.else_fn ? `, ${each_fn(block_data.else_fn)}` : ''})`;
            } else if (block.type === "await") {
                const block_data = CORE.block_cache.get(block.id);
                return `$DISPOSE_FNS[${++dispose_fn_i}] = $CORE.await($CHILD${block.child_index}, (() => ${block_data.expr}), ${await_fn(block_data.pending_fn)}, ${await_fn(block_data.then_fn, block_data.then_key)}, ${await_fn(block_data.catch_fn, block_data.catch_key)});`
            }
        }).join("\n\n\t\t")
}${
        (instruction.component_blocks.length > 0 ? `\n\n\t\t// IMPORTED COMPONENTS like <Component/> or\n\t\t// CORE COMPONENTS like <CoreComponent default="component_function"/>\n\t\t` : '') +
            instruction.component_blocks.map((block, i) => {
                const component = CORE.block_cache.get(block.props_id);
                const component_slot_fn_code = CORE.block_cache.get(block.slot_id);
                const props = Object.entries(component?.props || []);
                return `const $COMPONENT${i} = ${block.component ? `${block.component}` : `$COMPONENTS.${block.component_tag}`};
        const $COMPONENT${i}_PROPS = {${props.map((p) => `get ${p[0]}() { return (${p[1]}) }`).join(",") }${ (props.length > 0 && component.dynamic_props.length > 0) ? ',' : ''} ${component.dynamic_props.map((p) => `get ${p.key}(){ return (${p.expr}) }`).join(", ")}};
        if (!$COMPONENT${i}) throw new Error('component "<${block.component || block.component_tag}>" not found');
        $DISPOSE_FNS[${++dispose_fn_i}] = $CORE.core_component($CHILD${block.child_index}, $COMPONENT${i}, $COMPONENT${i}_PROPS, () => {${component_slot_fn_code?.replaceAll("\n", "\n\t") || ""}});`}).join("\n\n\t")
}${
        (instruction.use_directives.length > 0 ? '\n\n\t\t// USE DIRECTIVE\n\t' : '') +
            instruction.use_directives.map((directive, i) => {
                return `\t$DISPOSE_FNS[${++dispose_fn_i}] = ${directive.func_name}($CHILD${directive.child_index}, (${directive.expr})) || (() => {})`;
            }).join("\n\t")
}${
        instruction.slot_child_index > -1 ? `\n\n\t\t// COMPONENT SLOT like <CoreSlot/>
        if ($SLOT_FN) {
            const fragment = document.createDocumentFragment();
            $CORE.set_param_args(fragment);
            $DISPOSE_FNS[${++dispose_fn_i}] = $SLOT_FN();
            $CHILD${instruction.slot_child_index}.before(fragment);
        }` : ''
}

        $ANCHOR.append($TEMPLATE);
${
        options?.include_lifecycle ? `\n\t\tqueueMicrotask(() => $CORE.run_mount_fns())\n` : ''
}${
        options?.include_context ? `\n\t\t// RESET CONTEXT\n\t\t$CORE.set_new_context($OLD_CONTEXT);\n` : ''
}
        // CLEAN UP
        return () => {${
            options?.include_lifecycle ? `\n\t\t\t$CORE.run_destroy_fns();\n` : ''
        }
            for (const fn of $DISPOSE_FNS) fn();
            $DISPOSE_FNS.length = 0;
        ${
            options?.include_context ? `\n\t\t\t// RESET CONTEXT\n\t\t\t$CORE.set_new_context($OLD_CONTEXT);\n` : ''
        }
            const parent_node = $NODE_START.parentNode;
            if (parent_node) $CORE.remove_nodes(parent_node, $NODE_START, $NODE_END);

            ${ style_sheet ? `document.head.removeChild($STYLE)` : '' };
        }\n\t`;

    return render_code_string;
}

// SCOPE CSS

function splitSelectors(str) {
    if (!str) return [];

    const out = [];
    let start = 0, depth = 0;

    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === "(" || c === "[") depth++;
        else if (c === ")" || c === "]") depth--;
        else if (c === "," && depth === 0) {
            out.push(str.slice(start, i).trim());
            start = i + 1;
        }
    }

    out.push(str.slice(start).trim());
    return out;
}

function scopeSelector(selector, scope) {
    let depth = 0;
    let part = "", out = "";

    const flush = () => {
        if (!part) return;
        const i = part.search(/:{1,2}/);
        out += i < 0 ? part + `[${scope}]` : part.slice(0, i) + `[${scope}]` + part.slice(i);
        part = "";
    };

    for (const c of selector) {
        if (c === "(" || c === "[") depth++;
        else if (c === ")" || c === "]") depth--;

        if (depth === 0 && (c === ">" || c === "+" || c === "~" || c === " ")) {
            flush();
            out += c;
        } else {
            part += c;
        }
    }

    flush();

    return out;
}

/**
 * @param {DocumentFragment} fragment
 * @param {string} scope_id
 */
function apply_scope_css(fragment, scope_id) {
    let style_content = '';

    for (const child of Array.from(fragment.children)) {
        if (!(child instanceof HTMLStyleElement)) continue;
        style_content += child.innerHTML;
        fragment.removeChild(child);
    }

    if (!style_content) return;

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(style_content);

    return process_css_scoping_rules(sheet.cssRules, scope_id)
}

/**
 * @param {DocumentFragment} fragment
 */
function inject_scope_id_to_children(fragment, scope_id) {
    for (const child of Array.from(fragment.children)) {
        child.setAttribute(scope_id, "")
        if (child.children.length > 0) inject_scope_id_to_children(child, scope_id);
    }
}

function scopeSelectors(cssSelector, scope) {
    return splitSelectors(cssSelector).map(s => scopeSelector(s, scope)).join(", ");
}

/**
 * @param {CSSRuleList} rule
 * @param {string} scope_id
 */
function process_css_scoping_rules(rule, scope_id) {
    let style = "";

    for (let i = 0; i < rule.length; i++) {
        style += (rule[i] instanceof CSSMediaRule) ? `@media ${rule[i].conditionText} { ` : `${scopeSelectors(rule[i].selectorText, `${scope_id}`)} { ${rule[i].style.cssText} `;
        if (rule[i].cssRules?.length) style += process_css_scoping_rules(rule[i].cssRules, scope_id);
        style += ` } `
    }

    return style;
}

window.__core__ = CORE;

// CONTEXT API

const root_context = Object.create(null);
let current_context = root_context;

function create_new_context() {
    return Object.create(current_context);
}

function set_new_context(context) {
    const old_context = current_context;
    current_context = context;
    return old_context;
}

export function set_context(key, value) {
    current_context[key] = value;
}

export function get_context(key) {
    return current_context[key];
}

// LIFECYCLE API

/**
 * @param {CoreComponent} app
 * @param {HTMLElement} target
 * @returns {() => void} dispose function
 */
export function mount(app, target) {
    const context = create_new_context();
    context[CORE.MOUNT_FNS] = [];
    context[CORE.DESTROY_FNS] = [];

    set_new_context(context);
    CORE.set_param_args(typeof target === "string" ? document.querySelector(target) : target);

    return app();
}

function run_mount_fns() {
    for (const fn of current_context[CORE.MOUNT_FNS]) {
        const destroy_fn = fn();
        if (typeof destroy_fn === "function") current_context[CORE.DESTROY_FNS].push(destroy_fn);
    }
    current_context[CORE.MOUNT_FNS].length = 0;
}

function run_destroy_fns() {
    for (const fn of current_context[CORE.DESTROY_FNS]) fn();
    current_context[CORE.DESTROY_FNS].length = 0;
}

export function on_mount(fn) {
    current_context[CORE.MOUNT_FNS].push(fn);
}

export function on_destroy(fn) {
    current_context[CORE.DESTROY_FNS].push(fn);
}


// REACTIVITY

/** @type {Function[]} */
let effect_stack = [];
/** @type {Function | null} */
let current_effect = null;

/** @type {Set<Function>} */
const effect_queue = new Set();
/** @type {Set<Function>} */
const prio_effect_queue = new Set();
let is_flushing = false;

/**
 * @param {Set<Function>} dep
 */
function track(dep) {
    if (!current_effect || dep.has(current_effect)) return;
    dep.add(current_effect);
    current_effect.deps.push(dep);
}

/**
 * @param {Set<Function>} dep
 */
function trigger(dep) {
    for (const effect_fn of dep) (effect_fn.is_priority ? prio_effect_queue : effect_queue).add(effect_fn);

    if (is_flushing) return;
    is_flushing = true;

    queueMicrotask(() => {
        try {
            for (const fn of prio_effect_queue) fn();
            for (const fn of effect_queue) fn();
            for (const fn of ticks) fn();
        } catch (error) {
            console.error("effect microtask execution error\n", effect_queue, error)
        } finally {
            prio_effect_queue.clear();
            effect_queue.clear();
            ticks.length = 0;
            is_flushing = false;
        }
    });
}

/**
 * @param {Container} container
 */
function trigger_container(container) {
    for (const key in container.deps) trigger(container.deps[key]);
}

/**
 * @param {{ deps : Set<Function>, children : Set<Function> }[]} effect_fn
 */
function dispose_deps(effect_fn) {
    for (const dep of effect_fn.deps) dep.delete(effect_fn);
    effect_fn.deps.length = 0;

    for (const fn of effect_fn.children) fn();
    effect_fn.children.length = 0;
}

/** @type {Function[]} */
const ticks = [];

export function next_tick() {
    return new Promise((resolve) => ticks.push(resolve));
}

/**
 * Returns a dispose function for manually disposal of effect
 * @param {Function} fn
 * @param {{ track_inner_effect : boolean, is_priority : boolean }} options
 */
export function effect(fn, options = { track_inner_effect : true, is_priority : false }) {
    if (typeof fn !== "function") throw "Effect callback is not a function";

    let dispose_fn = null;
    let active = true;      // flag to prevent effect re-run if already dispose

    const dispose = () => {
        if (typeof dispose_fn !== "function") return
        try {
            dispose_fn();
        } catch (error) {
            console.trace("effect cleanup error\n", fn, error);
        } finally {
            dispose_fn = null;
        }
    }

    const wrapped = () => {
        if (!active) return;

        dispose();
        dispose_deps(wrapped);

        effect_stack.push(wrapped);
        current_effect = wrapped;

        try {
            dispose_fn = fn();
        } catch (error) {
            // error ares ignored because some are just effect residue
        } finally {
            effect_stack.pop();
            current_effect = effect_stack[effect_stack.length - 1] || null;
            if (current_effect?.track_inner_effect) current_effect.children.push(wrapped.dispose);
        }
    };

    wrapped.is_priority = options.is_priority;
    wrapped.track_inner_effect = options.track_inner_effect;

    /** @type {Set<Function>[]} */
    wrapped.deps = [];
    /** @type {Function[]} */
    wrapped.children = [];

    wrapped.dispose = () => {
        if (!active) return;
        active = false;
        dispose();
        dispose_deps(wrapped);
    };

    wrapped();

    return wrapped.dispose;
}

/**
 * @template {any} T
 * @param {T} initial_value
 */
export function signal(initial_value) {
    let value = initial_value;
    let container = null;
    let proxy = null;

    if (is_plain_object(initial_value)) {
        const is_proxy = initial_value[IS_PROXY];
        if (is_proxy) value = initial_value[CONTAINER].value;
        container = create_container(value);
        proxy = create_proxy(container);
    }

    const dep = new Set();

    const read = () => {
        track(dep);
        return container ? proxy : value;
    }

    /**
     * @param {T} new_value
     */
    const set = (new_value) => {
        if (typeof new_value === "function") new_value = new_value(value);

        if (is_plain_object(new_value)) {
            const is_proxy = new_value[IS_PROXY];
            const real_value = is_proxy ? new_value[CONTAINER].value : new_value;

            value = null;

            if (!container) {
                container = create_container(real_value);
            } else {
                container.value = real_value;
            }
            proxy = create_proxy(container);

            trigger(dep);
            trigger_container(container);

            return;
        }

        if (value === new_value) return;

        value = new_value;
        container = proxy = null;

        trigger(dep);
    }

    return [read, set];
}

export function memo(fn) {
    const [value, setValue] = signal();
    effect(() => setValue(fn()), { is_priority : true });
    return value;
}

const array_mutation_keys = new Set(["push","pop","shift","unshift","splice","sort","reverse","fill","copyWithin"]);

const IS_PROXY = Symbol("proxy");
const CONTAINER = Symbol("container");

const is_plain_object = (v) => v && typeof v === 'object' && ((Object.getPrototypeOf(v) === null || Object.getPrototypeOf(v) === Object.prototype) || Array.isArray(v));

/** @typedef {ReturnType<typeof create_container>} Container */

function create_container(object) {
    return {
        value: object,
        deps: Object.create(null),
        child_containers: Object.create(null),
    };
}

/** @type {WeakMap<Object, Container>} */
const object_to_container = new WeakMap();
const handler = {
    get(target, key) {
        const container = object_to_container.get(target);

        if (key === IS_PROXY) return true;
        if (key === CONTAINER) return container;

        const value = container.value[key];
        const dep = container.deps[key] || (container.deps[key] = new Set());

        if (!is_plain_object(value)) {
            if (typeof value !== "function") {
                track(dep);
                return value;
            }

            if (!Array.isArray(target)) return value;

            // Trigger update when target is an array and is being mutated
            return (...args) => {
                const result = target[key](...args);

                if (!array_mutation_keys.has(key)) return result;

                trigger(dep);
                trigger_container(container);

                return result;
            }
        }

        track(dep);

        let child_container = container.child_containers[key];
        if (child_container) {
            if (child_container.value !== value) {
                child_container.value = value;
                child_container.proxy = create_proxy(child_container);
            }
            return child_container.proxy;
        }

        child_container = create_container(value);
        child_container.proxy = create_proxy(child_container);

        container.child_containers[key] = child_container;

        return child_container.proxy;
    },
    set(target, key, value) {
        const container = object_to_container.get(target);
        const dep = container.deps[key] || (container.deps[key] = new Set());

        if (target[key] === value) return true;

        target[key] = value;

        trigger(dep);

        return true;
    },
    deleteProperty(target, key) {
        const container = object_to_container.get(target);
        delete target[key];

        const dep = container.deps[key] || (container.deps[key] = new Set());
        trigger(dep);

        return true;
    }
}

/**
 * @param {Container} container
 */
function create_proxy(container) {
    object_to_container.set(container.value, container);
    return new Proxy(container.value, handler);
}

// HELPER FUNCTIONS

/** @type {(template_url:string) => Promise<string>} */
export const load = (template_url) => fetch(template_url).then((response) => response.text());

 /** @type {(length:number) => string} */
export const make_id = (length) => {
     let result = '';
     const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
     for (var i = 0; i < length; i++) result += characters.charAt(Math.floor(Math.random() * characters.length));
     return result;
 }

// DIRECTIVES

export function bind(node, [value, get, set]) {
    const event_name_dictionary = { "checked": node.type === "date" ? "change" : "click", "value": node.tagName === "select" ? "change" : "input" };
    CORE.delegate(event_name_dictionary[value], node, (e) => set(e.target[value]))
    return CORE.effect(() => node[value] = get());
}

export function html(node, arg) {
    return effect(() => { node.innerHTML = arg; })
}
