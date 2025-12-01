import { Remote } from "./remote.js";

const headerEl = document.getElementById("h1El");
const data = await Remote.greetings({ age: 25, name: "ice", x: new File(['sefsfse'], 'hello_world.txt') });

headerEl.textContent = data.message;
console.log("server date:", data.date);
