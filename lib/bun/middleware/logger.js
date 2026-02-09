import { appendFile } from "node:fs";
import { Logger } from '../../colorful_log.js';

/**
 * @param {string} dir
 * @param {{ print_log:boolean, write_log : boolean, log_file : string }} options
 */
export function logger(options = { print_log: true, write_log: false, log_file: "" }) {
    const logger = new Logger();

    /**
     * @param {Request} req
     */
    return (req) => {
        const date = new Date();

        if (options.print_log) logger
            .color("white").append(`[${date.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${date.toLocaleTimeString('en-US', { hourCycle: 'h24' })}]`)
            .color("cyan").append(` ${req.ip.address}`)
            .color("white").append(`:`)
            .color("cyan").append(`${req.ip.port} `)
            .color("green").append(` ${req.method}${' '.repeat(6 - req.method.length)}`)
            .color("blue").append(`${req.path}`)
            .log()
            .clear();

        if (options.write_log) {
            appendFile(options.log_file, `[${date.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${date.toLocaleTimeString('en-US', { hourCycle: 'h24' })}] ${req.ip.address}:${req.ip.port} ${req.method}${' '.repeat(6 - req.method.length)}${req.path}\n`, (err) => {
                if (err) console.error(err);
            })
        }
    }
}
