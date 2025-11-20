import { Remote } from "./remote.js";

const headerEl = document.getElementById("h1El");
const data = await Remote.greetings({ age: 25, name: "ice" });

headerEl.textContent = data.message;
console.log("server date:", data.date);
