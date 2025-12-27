import { connectRemote } from "./remote.js";

/** @import RemoteFunction from '../remote_api.js' */
/** @type {RemoteFunction} */
const REMOTE = connectRemote("/api/remote", {
    'x-auth': 'jeff'
});

const data = await REMOTE.example_function(new Map([[1, 'hello_from_client_as_file']]), new Date())
console.log(data);
