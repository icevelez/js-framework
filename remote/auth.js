import { randomUUIDv7, sql } from "bun";
import { text } from "stream/consumers";

export default class {

    /** @type {Bun.SQL} */
    #database;
    #get_request_context;
    #set_response_headers;
    /** @type {Map<string, { user:{ id:number, username:string, admin:boolean }, expiry:Date }>} */
    #in_memory_session;

    #has_session = async () => {
        const session_id = this.#get_request_context().cookies.get("session_id");
        if (!session_id) return;

        const session = this.#in_memory_session.get(session_id);
        if (!session) return;

        return session.user;
    }

    /**
     * @param {Bun.SQL} database
     * @param {() => Request} get_request_context
     * @param {({ [key:string] : string }) => void} set_response_headers
     */
    constructor(database, get_request_context, set_response_headers, in_memory_session) {
        if (!database) throw new Error("no database adaptor");
        if (!get_request_context) throw new Error("no get_request_context");
        if (!set_response_headers) throw new Error("no set_response_headers");
        if (!in_memory_session) throw new Error("no in_memory_session");
        this.#database = database;
        this.#get_request_context = get_request_context;
        this.#set_response_headers = set_response_headers;
        this.#in_memory_session = in_memory_session;
    }

    get_session = async () => {
        return this.#has_session();
    }

    /**
     * @param {string} username
     * @param {string} password
     */
    sign_in = async (username, password) => {
        const example_users = [
            { id: 1, username: 'admin', admin: true, password: 'admin' },
            { id: 2, username: 'john', admin: false, password: 'dev' },
            { id: 3, username: 'albert', admin: false, password: '35s3f' },
        ]

        const { password: text_password, ...user } = example_users.filter((user) => user.username === username)[0] || {};
        if (!user || password !== text_password) throw new Error("invalid username or password");

        const session = await this.#has_session()
        if (session) throw new Error("user already logged in");

        const session_uuid = randomUUIDv7();
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + 1);

        this.#set_response_headers({ 'Set-cookie': `session_remote_id=${session_uuid}; expires=${expiry.toUTCString()}` });

        this.#in_memory_session.set(session_uuid, { user, expiry });

        return user;
    }

    sign_out = async () => {
        const session_id = this.#get_request_context().cookies.get("session_remote_id");
        if (!session_id) return false;

        this.#in_memory_session.delete(session_id);

        this.#set_response_headers({ 'Set-cookie': `session_remote_id=;` });
        return true;
    }
}
