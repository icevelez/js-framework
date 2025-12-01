import { Remote } from "./remote.js";

const headerEl = document.getElementById("h1El");
const data = await Remote.greetings({ age: 25, name: "ice" }, new File(['sefsfse'], 'hello_world.txt'));

console.log("greetings:", data);
console.log("server add number:", await Remote.add_numbers(69, 69));

headerEl.textContent = data.message;
console.log("server date:", data.date);

let count = 0;
const maxCount = 5;

const recurseCall = async () => {
    if (count >= maxCount) return;

    await Remote.console_log("Hello from client counter: " + count);
    count++;
    setTimeout(recurseCall, 1000);
}

recurseCall()
