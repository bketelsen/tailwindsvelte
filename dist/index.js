(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.Tailwindsvelte = factory());
}(this, (function () { 'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : options.context || []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    /* src/ArticleCard.svelte generated by Svelte v3.38.2 */

    function create_fragment(ctx) {
    	let div6;
    	let div0;
    	let img;
    	let img_src_value;
    	let img_alt_value;
    	let img_width_value;
    	let img_height_value;
    	let t0;
    	let div5;
    	let div1;
    	let p0;
    	let a0;
    	let t1_value = (/*article*/ ctx[0].category && /*article*/ ctx[0].category.name) + "";
    	let t1;
    	let a0_href_value;
    	let t2;
    	let a1;
    	let p1;
    	let t3_value = /*article*/ ctx[0].title + "";
    	let t3;
    	let t4;
    	let p2;
    	let t5_value = /*article*/ ctx[0].excerpt + "";
    	let t5;
    	let a1_href_value;
    	let t6;
    	let div4;

    	return {
    		c() {
    			div6 = element("div");
    			div0 = element("div");
    			img = element("img");
    			t0 = space();
    			div5 = element("div");
    			div1 = element("div");
    			p0 = element("p");
    			a0 = element("a");
    			t1 = text(t1_value);
    			t2 = space();
    			a1 = element("a");
    			p1 = element("p");
    			t3 = text(t3_value);
    			t4 = space();
    			p2 = element("p");
    			t5 = text(t5_value);
    			t6 = space();
    			div4 = element("div");

    			div4.innerHTML = `<div><div class="flex space-x-1 text-sm text-gray-500"><time datetime="2020-03-10">Mar 10, 2020</time> 
                    <span aria-hidden="true">·</span> 
                    <span>4 min read</span></div></div>`;

    			attr(img, "class", "h-48 w-full object-cover");
    			if (img.src !== (img_src_value = "/" + /*article*/ ctx[0].image.file_name)) attr(img, "src", img_src_value);
    			attr(img, "alt", img_alt_value = /*article*/ ctx[0].title);
    			attr(img, "width", img_width_value = /*article*/ ctx[0].image.width);
    			attr(img, "height", img_height_value = /*article*/ ctx[0].image.height);
    			attr(div0, "class", "flex-shrink-0");
    			attr(a0, "href", a0_href_value = "/categories/" + /*article*/ ctx[0].category_id);
    			attr(a0, "class", "hover:underline");
    			attr(p0, "class", "text-sm font-medium text-cyan-800");
    			attr(p1, "class", "text-xl font-semibold text-gray-900");
    			attr(p2, "class", "mt-3 text-base text-gray-500");
    			attr(a1, "href", a1_href_value = "/articles/" + /*article*/ ctx[0].id);
    			attr(a1, "class", "block mt-2");
    			attr(div1, "class", "flex-1");
    			attr(div4, "class", "mt-6 flex items-center");
    			attr(div5, "class", "flex-1 bg-white p-6 flex flex-col justify-between");
    			attr(div6, "class", "flex flex-col rounded-lg shadow-lg overflow-hidden");
    		},
    		m(target, anchor) {
    			insert(target, div6, anchor);
    			append(div6, div0);
    			append(div0, img);
    			append(div6, t0);
    			append(div6, div5);
    			append(div5, div1);
    			append(div1, p0);
    			append(p0, a0);
    			append(a0, t1);
    			append(div1, t2);
    			append(div1, a1);
    			append(a1, p1);
    			append(p1, t3);
    			append(a1, t4);
    			append(a1, p2);
    			append(p2, t5);
    			append(div5, t6);
    			append(div5, div4);
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*article*/ 1 && img.src !== (img_src_value = "/" + /*article*/ ctx[0].image.file_name)) {
    				attr(img, "src", img_src_value);
    			}

    			if (dirty & /*article*/ 1 && img_alt_value !== (img_alt_value = /*article*/ ctx[0].title)) {
    				attr(img, "alt", img_alt_value);
    			}

    			if (dirty & /*article*/ 1 && img_width_value !== (img_width_value = /*article*/ ctx[0].image.width)) {
    				attr(img, "width", img_width_value);
    			}

    			if (dirty & /*article*/ 1 && img_height_value !== (img_height_value = /*article*/ ctx[0].image.height)) {
    				attr(img, "height", img_height_value);
    			}

    			if (dirty & /*article*/ 1 && t1_value !== (t1_value = (/*article*/ ctx[0].category && /*article*/ ctx[0].category.name) + "")) set_data(t1, t1_value);

    			if (dirty & /*article*/ 1 && a0_href_value !== (a0_href_value = "/categories/" + /*article*/ ctx[0].category_id)) {
    				attr(a0, "href", a0_href_value);
    			}

    			if (dirty & /*article*/ 1 && t3_value !== (t3_value = /*article*/ ctx[0].title + "")) set_data(t3, t3_value);
    			if (dirty & /*article*/ 1 && t5_value !== (t5_value = /*article*/ ctx[0].excerpt + "")) set_data(t5, t5_value);

    			if (dirty & /*article*/ 1 && a1_href_value !== (a1_href_value = "/articles/" + /*article*/ ctx[0].id)) {
    				attr(a1, "href", a1_href_value);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div6);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let { article } = $$props;

    	$$self.$$set = $$props => {
    		if ("article" in $$props) $$invalidate(0, article = $$props.article);
    	};

    	return [article];
    }

    class ArticleCard extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, { article: 0 });
    	}
    }

    return ArticleCard;

})));
