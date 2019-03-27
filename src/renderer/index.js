import "./logger";
// require("@webcomponents/webcomponentsjs/webcomponents-loader.js");
// import "@webcomponents/webcomponentsjs/webcomponents-loader.js";
import * as RoosterX from "./web-components/RoosterX";
// require("./web-components/RoosterX");

document.documentElement.innerHTML = require("./index.html");

// adding the base path to index page
const base = document.createElement("base");
base.href = "./";
document.head.appendChild(base);
//
console.log("sdfsdf");
setTimeout(() => {

    console.log("asdf");
    const appElement = document.getElementById("app");
    const rooster = new RoosterX();
    console.log(rooster);
    if (appElement) {
        appElement.appendChild(rooster);
    }
}, 3000);


// if (appElement) {
//     appElement.setAttribute("id", "app-root");
// }
