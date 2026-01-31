import { connectRemote } from "./remote.js";

/** @import RemoteExample from '../remote/example.js' */
/** @type {RemoteExample} */
const REMOTE = connectRemote("/remote/api/example");

/** @import RemoteAuth from '../remote/auth.js' */
/** @type {RemoteAuth} */
const REMOTE_AUTH = connectRemote("/remote/auth");

// 'john', 'dev' for non admin example use
console.log(await REMOTE_AUTH.sign_in('admin', 'admin'));
console.log(await REMOTE.add_numbers(4, 5));
console.log(await REMOTE_AUTH.sign_out());

const file_input_el = document.getElementById("file_input_el");
const upload_button_el = document.getElementById("upload_button_el");
const delete_button_el = document.getElementById("delete_button_el");

const filename = 'example_picture';

upload_button_el.addEventListener('click', async (event) => {
    const fileList = file_input_el.files;
    const file = fileList[0];
    if (!file) return console.log("No file");

    console.log(await REMOTE.upload_picture(file, filename));
})

delete_button_el.addEventListener('click', async (event) => {
    console.log(await REMOTE.delete_picture(filename));
})
