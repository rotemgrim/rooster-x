// import * as util from "util";
// import {remote} from "electron";
//
// const mainConsole = remote.getGlobal("console");
// const prettyPrint = (data) => {
//     try {
//         return JSON.stringify(data, null, 2);
//     } catch (e) {
//         return util.inspect(data);
//     }
// };
//
// (function () {
//     if (window.console && console.log) {
//         const oldLog = console.log;
//         console.log = function () {
//             oldLog.apply(this, arguments);
//
//             let msg = "Renderer | ";
//             if (arguments.length > 1 && arguments[0] && typeof arguments[0] === "string") {
//                 const str = Array.prototype.shift.apply(arguments);
//                 msg += str + " -> " + prettyPrint(arguments);
//             } else if (arguments.length > 1 && arguments[0] && typeof arguments[0] === "string" && arguments.length === 1) {
//                 msg += arguments[0];
//             } else {
//                 msg += " -> " + prettyPrint(arguments);
//             }
//             mainConsole.log(msg);
//         };
//
//         console.error = function () {
//             oldLog.apply(this, arguments);
//
//             let msg = "Renderer(error) | ";
//             if (arguments.length > 1 && arguments[0] && typeof arguments[0] === "string") {
//                 const str = Array.prototype.shift.apply(arguments);
//                 msg += str + " -> " + prettyPrint(arguments);
//             } else if (arguments.length > 1 && arguments[0] && typeof arguments[0] === "string" && arguments.length === 1) {
//                 msg += arguments[0];
//             } else {
//                 msg += " -> " + prettyPrint(arguments);
//             }
//             mainConsole.log(msg);
//         };
//     }
// })();
//
// //
// // console = mainConsole;
// // console.log = function() {
// //     Array.prototype.unshift.call(arguments, "Renderer: ");
// //     mainConsole.log(arguments);
// //     oldConsole.log(arguments);
// // };
