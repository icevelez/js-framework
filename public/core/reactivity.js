import { signal, effect } from "core";

/**
* Reactive Map backed by signals.
*
* Notes:
* - Uses a plain object internally
* - Reactivity is driven by replacing the internal object when mutations happen.
*
* @example
* const m = new CoreMap([['a', 1]]);
* m.set('b', 2);
* m.get('a') // 1
* m.size     // 2
*/
export class CoreMap {
    #getProxy;
    #setProxy;

    #getSize;
    #setSize;

    constructor(entries = []) {
        const [getProxy, setProxy] = signal({});
        this.#getProxy = getProxy;
        this.#setProxy = setProxy;

        const [getSize, setSize] = signal(0);
        this.#getSize = getSize;
        this.#setSize = setSize;

        for (const [k, v] of entries) {
            this.set(k, v);
        }
    }

    /**
    * Get a value by key.
    * @param {string|number|symbol} key
    * @returns {*}
    */
    get = (key) => {
        return this.#getProxy()[key];
    };

    /**
    * Check whether a key exists.
    * @param {string|number|symbol} key
    * @returns {boolean}
    */
    has = (key) => {
        const obj = this.#getProxy();
        return Object.prototype.hasOwnProperty.call(obj, key);
    };

    /**
    * Set a key to a value.
    * @param {string|number|symbol} key
    * @param {*} value
    * @returns {CoreMap} this
    */
    set = (key, value) => {
        const obj = this.#getProxy();
        const had = Object.prototype.hasOwnProperty.call(obj, key);

        if (obj[key] === value && had) return this; // optional: avoid extra updates

        this.#setProxy(() => {
        obj[key] = value;
        return obj;
        });

        if (!had) this.#setSize(this.#getSize() + 1);

        return this;
    };

    /**
    * Delete a key.
    * @param {string|number|symbol} key
    * @returns {boolean} Whether a key was removed.
    */
    delete = (key) => {
        const obj = this.#getProxy();
        const had = Object.prototype.hasOwnProperty.call(obj, key);
        if (!had) return false;

        const next = obj;
        delete next[key];

        this.#setProxy(next);
        this.#setSize(this.#getSize() - 1);
        return true;
    };

    /**
    * Clear all entries.
    * @returns {void}
    */
    clear = () => {
        if (this.#getSize() === 0) return;
        this.#setProxy({});
        this.#setSize(0);
    };

    /**
    * Iterate keys.
    * @returns {IterableIterator<string>}
    */
    keys = () => {
        const obj = this.#getProxy();
        return Object.keys(obj)[Symbol.iterator]();
    };

    /**
    * Iterate values.
    * @returns {IterableIterator<*>}
    */
    values = () => {
        const obj = this.#getProxy();
        const keys = Object.keys(obj);
        return (function* () {
        for (const k of keys) yield obj[k];
        })();
    };

    /**
    * Iterate entries.
    * @returns {IterableIterator<[string, *]>}
    */
    entries = () => {
        const obj = this.#getProxy();
        const keys = Object.keys(obj);
        return (function* () {
        for (const k of keys) yield [k, obj[k]];
        })();
    };

    /**
    * Default iterator (entries).
    * @returns {IterableIterator<[string, *]>}
    */
    [Symbol.iterator] = () => {
        return this.entries();
    };

    /**
    * Current number of keys.
    * @returns {number}
    */
    get size() {
        return this.#getSize();
    }
}

/**
* Reactive Set backed by signals.
*
* Notes:
* - Uses a plain object internally
* - Reactivity is driven by updating the internal object.
*
* @example
* const s = new CoreSet([1, 2]);
* s.add(3);
* s.has(2); // true
* s.size;   // 3
*/
export class CoreSet {
    #getProxy;
    #setProxy;

    #getSize;
    #setSize;

    constructor(values = []) {
        const [getProxy, setProxy] = signal({});
        this.#getProxy = getProxy;
        this.#setProxy = setProxy;

        const [getSize, setSize] = signal(0);
        this.#getSize = getSize;
        this.#setSize = setSize;

        for (const v of values) this.add(v);
    }

    /**
    * Check whether a value exists.
    * @param {string|number|symbol} value
    * @returns {boolean}
    */
    has = (value) => {
        const obj = this.#getProxy();
        return Object.prototype.hasOwnProperty.call(obj, value);
    };

    /**
    * Add a value.
    * @param {string|number|symbol} value
    * @returns {CoreSet} this
    */
    add = (value) => {
        const obj = this.#getProxy();
        const had = Object.prototype.hasOwnProperty.call(obj, value);
        if (had) return this;

        this.#setProxy(() => {
        obj[value] = true;
        return obj;
        });

        this.#setSize(this.#getSize() + 1);
        return this;
    };

    /**
    * Delete a value.
    * @param {string|number|symbol} value
    * @returns {boolean} Whether a value was removed.
    */
    delete = (value) => {
        const obj = this.#getProxy();
        const had = Object.prototype.hasOwnProperty.call(obj, value);
        if (!had) return false;

        const next = { ...obj };
        delete next[value];

        this.#setProxy(next);
        this.#setSize(this.#getSize() - 1);
        return true;
    };

    /**
    * Clear all values.
    * @returns {void}
    */
    clear = () => {
        if (this.#getSize() === 0) return;
        this.#setProxy({});
        this.#setSize(0);
    };

    /**
    * Iterate values.
    * @returns {IterableIterator<string>}
    */
    values = () => {
        const obj = this.#getProxy();
        return Object.keys(obj)[Symbol.iterator]();
    };

    /**
    * Alias for values().
    * @type {CoreSet["values"]}
    */
    keys = this.values;

    /**
    * Iterate entries as [value, value] (Set-like).
    * @returns {IterableIterator<[string, string]>}
    */
    entries = () => {
        const obj = this.#getProxy();
        const keys = Object.keys(obj);
        return (function* () {
        for (const k of keys) yield [k, k];
        })();
    };

    /**
    * Default iterator (values()).
    * @returns {IterableIterator<string>}
    */
    [Symbol.iterator] = () => this.values();

    /**
    * Iterate values and invoke callback like Array.prototype.forEach.
    * @param {(value: string, value2: string, set: CoreSet) => void} cb
    * @param {*} [thisArg]
    * @returns {void}
    */
    forEach = (cb, thisArg) => {
        for (const v of this) cb.call(thisArg, v, v, this);
    };

    /**
    * Current number of values.
    * @returns {number}
    */
    get size() {
        return this.#getSize();
    }
}

/**
 * Creates a media query and provides a `current` property that reflects whether or not it matches.
 *
 * @example
 * const mq = new CoreMediaQuery('(prefers-reduced-motion: reduce)');
 * mq.current; // boolean
 */
export class CoreMediaQuery {
    #get;
    #set;
    #mql;
    #onChange = null;

    /**
    * @param {string} query A media query string (e.g. "(max-width: 600px)").
    */
    constructor(query) {
        const [get, set] = signal(false);
        this.#get = get;
        this.#set = set;

        this.#mql = window.matchMedia(query);
        this.#set(this.#mql.matches);
        this.#onChange = () => this.#set(this.#mql.matches);

        this.dispose = effect(() => {
            this.#mql.addEventListener("change", this.#onChange);
            return () => {
                this.#mql.removeEventListener("change", this.#onChange);
                this.#mql = null;
            }
        });
    }

    /**
    * Whether the media query currently matches.
    * @returns {boolean}
    */
    get current() {
        return this.#get();
    }

    /**
    * Remove the underlying `matchMedia` listener.
    * @type {() => void}
    */
    dispose;
}

/**
 * Reactive Date wrapper backed by a numeric signal (timestamp).
 *
 * Mutating methods update the underlying signal by writing `timestamp`,
 * so any signal consumers will update.
 *
 * @example
 * const d = new CoreDate();
 * d.timestamp; // number
 * d.value;     // Date
 * d.setFullYear(2026).toISOString();
 */
export class CoreDate {
    #getTime;
    #setTime;

    /**
    * @param {number|Date} [initial=Date.now()] A timestamp number or a Date instance.
    */
    constructor(initial = Date.now()) {
        const initialTime =
        initial instanceof Date ? initial.getTime() : new Date(initial).getTime();

        const [getTime, setTime] = signal(initialTime);
        this.#getTime = getTime;
        this.#setTime = setTime;
    }

    /**
    * Reactive timestamp value (milliseconds since epoch).
    * @returns {number}
    */
    get timestamp() {
        return this.#getTime();
    }

    /**
    * Update the date via a timestamp (milliseconds since epoch).
    * @param {number} t
    */
    set timestamp(t) {
        this.#setTime(Number(t));
    }

    /**
    * Date facade (constructed from the current timestamp).
    * @returns {Date}
    */
    get value() {
        return new Date(this.#getTime());
    }

    /**
    * Set the date via a Date instance or date-like value.
    * @param {Date|number|string} d
    */
    set value(d) {
        this.timestamp = d instanceof Date ? d.getTime() : new Date(d).getTime();
    }

    /**
    * Set year/month/day.
    * @returns {CoreDate} this
    */
    setFullYear = (year, month, date) => {
        const d = this.value;
        if (month === undefined) d.setFullYear(year);
        else if (date === undefined) d.setFullYear(year, month);
        else d.setFullYear(year, month, date);
        this.timestamp = d.getTime();
        return this;
    };

    /**
    * Set month (optionally with day).
    * @returns {CoreDate} this
    */
    setMonth = (month, date) => {
        const d = this.value;
        if (date === undefined) d.setMonth(month);
        else d.setMonth(month, date);
        this.timestamp = d.getTime();
        return this;
    };

    /**
    * Set day of month.
    * @returns {CoreDate} this
    */
    setDate = (date) => {
        const d = this.value;
        d.setDate(date);
        this.timestamp = d.getTime();
        return this;
    };

    /**
    * Set hours (optionally minutes/seconds/ms).
    * @returns {CoreDate} this
    */
    setHours = (hours, min, sec, ms) => {
        const d = this.value;
        if (min === undefined) d.setHours(hours);
        else if (sec === undefined) d.setHours(hours, min);
        else if (ms === undefined) d.setHours(hours, min, sec);
        else d.setHours(hours, min, sec, ms);
        this.timestamp = d.getTime();
        return this;
    };

    /**
    * Set minutes (optionally seconds/ms).
    * @returns {CoreDate} this
    */
    setMinutes = (min, sec, ms) => {
        const d = this.value;
        if (sec === undefined) d.setMinutes(min);
        else if (ms === undefined) d.setMinutes(min, sec);
        else d.setMinutes(min, sec, ms);
        this.timestamp = d.getTime();
        return this;
    };

    /**
    * Set seconds (optionally ms).
    * @returns {CoreDate} this
    */
    setSeconds = (sec, ms) => {
        const d = this.value;
        if (ms === undefined) d.setSeconds(sec);
        else d.setSeconds(sec, ms);
        this.timestamp = d.getTime();
        return this;
    };

    /**
    * Set milliseconds.
    * @returns {CoreDate} this
    */
    setMilliseconds = (ms) => {
        const d = this.value;
        d.setMilliseconds(ms);
        this.timestamp = d.getTime();
        return this;
    };

    /**
    * Milliseconds since epoch.
    * @returns {number}
    */
    getTime = () => this.#getTime();

    /**
    * Convert to ISO string.
    * @returns {string}
    */
    toISOString = () => this.value.toISOString();

    /**
    * Convert to string.
    * @returns {string}
    */
    toString = () => this.value.toString();

    /**
    * ValueOf (timestamp).
    * @returns {number}
    */
    valueOf = () => this.#getTime();
}

/**
 * Reactive URL wrapper backed by a string href signal.
 *
 * Any updates are written to `href`, and all other properties are read
 * from a freshly parsed `URL` instance.
 *
 * @example
 * const u = new CoreURL('https://example.com/path?x=1');
 * u.href;        // reactive string
 * u.hostname;    // 'example.com'
 * u.hash = '#a';
 */
export class CoreURL {
    #getHref;
    #setHref;

    /**
    * @param {string|URL} initial URL string or URL instance.
    * @param {string} [base] Optional base URL for relative URLs.
    */
    constructor(initial, base) {
        const url = this.#coerceToURL(initial, base);
        const href = url.href;

        const [getHref, setHref] = signal(href);
        this.#getHref = getHref;
        this.#setHref = setHref;
    }

    /**
    * @param {string|URL} initial
    * @param {string|undefined} base
    * @returns {URL}
    */
    #coerceToURL(initial, base) {
        if (initial instanceof URL) return initial;
        return base ? new URL(String(initial), base) : new URL(String(initial));
    }

    /**
    * Reactive href string.
    * @returns {string}
    */
    get href() {
        return this.#getHref();
    }

    /**
    * Update URL via href string.
    * @param {string} v
    */
    set href(v) {
        this.#setHref(String(v));
    }

    /**
    * URL facade (constructed from the current href).
    * @returns {URL}
    */
    get value() {
        return new URL(this.#getHref());
    }

    /**
    * Replace URL from a URL instance or URL-like value.
    * @param {URL|string} u
    */
    set value(u) {
        this.href = u instanceof URL ? u.href : String(u);
    }

    // --- Common URL props (read-only via parsed URL) ---

    /** @returns {string} */
    get protocol() {
        return this.value.protocol;
    }
    /** @returns {string} */
    get username() {
        return this.value.username;
    }
    /** @returns {string} */
    get password() {
        return this.value.password;
    }
    /** @returns {string} */
    get host() {
        return this.value.host;
    }
    /** @returns {string} */
    get hostname() {
        return this.value.hostname;
    }
    /** @returns {string} */
    get port() {
        return this.value.port;
    }
    /** @returns {string} */
    get pathname() {
        return this.value.pathname;
    }
    /** @returns {string} */
    get search() {
        return this.value.search;
    }
    /** @returns {string} */
    get hash() {
        return this.value.hash;
    }

    // --- Setters (update href to trigger reactivity) ---

    /**
    * @param {string} v
    */
    set protocol(v) {
        const u = this.value;
        u.protocol = String(v);
        this.href = u.href;
    }
    /**
    * @param {string} v
    */
    set username(v) {
        const u = this.value;
        u.username = String(v);
        this.href = u.href;
    }
    /**
    * @param {string} v
    */
    set password(v) {
        const u = this.value;
        u.password = String(v);
        this.href = u.href;
    }
    /**
    * @param {string} v
    */
    set host(v) {
        const u = this.value;
        u.host = String(v);
        this.href = u.href;
    }
    /**
    * @param {string} v
    */
    set hostname(v) {
        const u = this.value;
        u.hostname = String(v);
        this.href = u.href;
    }
    /**
    * @param {string} v
    */
    set port(v) {
        const u = this.value;
        u.port = String(v);
        this.href = u.href;
    }
    /**
    * @param {string} v
    */
    set pathname(v) {
        const u = this.value;
        u.pathname = String(v);
        this.href = u.href;
    }
    /**
    * @param {string} v
    */
    set search(v) {
        const u = this.value;
        u.search = String(v);
        this.href = u.href;
    }
    /**
    * @param {string} v
    */
    set hash(v) {
        const u = this.value;
        u.hash = String(v);
        this.href = u.href;
    }

    /**
    * @returns {string}
    */
    toString() {
        return this.href;
    }

    /**
    * @returns {string}
    */
    valueOf() {
        return this.href;
    }
}
