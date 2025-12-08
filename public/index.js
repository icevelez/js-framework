import { connectRemote } from "./remote.js";

/** @import {remote_functions} from '../remote_api.js' */
/** @type {typeof remote_functions} */
const Remote = connectRemote("/api/remote");

/** @type {HTMLHeadingElement} */
const headerEl = document.getElementById("h1_el");
/** @type {HTMLButtonElement} */
const buttonEl = document.getElementById("upload_button_el");
/** @type {HTMLInputElement} */
const fileInputEl = document.getElementById("file_input_el");

buttonEl.addEventListener('click', async () => {
    const fileList = fileInputEl.files;
    if (!fileList) return;

    const file = fileList[0];
    if (!file) return;

    const message = await Remote.upload_file(file);
    console.log(message);
})

const data = await Remote.greetings({ age: 25, name: "ice" }, new File(['sefsfse'], 'hello_world.txt'));

console.log("greetings:", data);
console.log("server add number:", await Remote.add_numbers(69, 69));

headerEl.textContent = data.message;
console.log("server date:", data.date);

let count = 0;
const maxCount = 5;

const recurseCall = async () => {
    if (count > maxCount) return;

    await Remote.console_log("Hello from client counter: " + count);
    count++;
    setTimeout(recurseCall, 1000);
}

recurseCall()
