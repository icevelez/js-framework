/** @import { Request, Response } from './http' */

/**
 * @template {any} T
 * @param {(request:Request, response:Response) => T} fn
 */
export function createAuth(fn) {
    let context;
    return {
        context: {
            /**
             * @returns {T}
             */
            getContext: () => context
        },
        /**
         * @param {Request} req
         * @param {Response} res
         */
        middleware: async (req, res) => {
            context = fn(req, res);
            if (context instanceof Promise) context = await context;
        },
    }
}
