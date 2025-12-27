/** @import { createAuth } from "./lib/auth.js" */
/** @import { Pool } from "pg"; */

/**
 * @template {any} T
 */
export default class {

    /** @type {Pool} */
    #database;

    /** @type {ReturnType<typeof createAuth<any>>['context']} */
    #auth;

    /**
     * @param {Pool} database
     * @param {ReturnType<typeof createAuth<T>>['context']} auth
     */
    constructor(database, auth) {
        if (!database) throw new Error("no database adaptor");
        if (!auth) throw new Error("no auth adaptor");
        this.#database = database;
        this.#auth = auth;
    }

    example_function = async (data, ...args) => {
        const user_data = this.#auth.getContext();
        if (!user_data) throw new Error("no user. unauthorized");

        // await this.#database.query("SOME SQL INSERT EXAMPLE", data);

        console.log(data, args);

        return {
            message: `Hello from server ${user_data}`,
            map: new Map([[1, "this is an example"], [2, "another example xyz"]]),
            file: new File(['hello'], 'hello_word.txt'),
            test_data: new Date(),
            set: new Set([1, 2, 2, 2, 2, 2, 3, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, 0]),
        };
    }

    /**
     * Example comment
     * @param {File} file
     */
    upload_file = async (file) => {
        console.log(this.#auth.getContext())
        console.log("Uploaded File:", file);
        return "Upload Sucessful!";
    }
}
