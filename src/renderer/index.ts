
import NAME from "../common/common";
import "@webcomponents/webcomponentsjs/webcomponents-loader.js";
import {RoosterX} from "./web-components/RoosterX";

// document.documentElement.innerHTML = require("./index.html");
window.addEventListener("DOMContentLoaded", () => {
  console.log("test", NAME);
  // init();
  const appElement = document.getElementById("app");
  const rooster = new RoosterX();
  if (appElement) {
    appElement.appendChild(rooster);
  }
});
