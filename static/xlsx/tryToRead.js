const XLSX = require("xlsx");
const XlsxPopulate = require("xlsx-populate");
const fs = require("fs");

function getFileSizeInMegabytes(filename) {
    return new Promise((resolve, reject) => {
        fs.stat(filename, (err, stats) => {
            if (err) {
                // console.error("cant get filename stats", err);
                resolve(10);
                return;
            }

            const fileSizeInBytes = stats.size;

            // Convert the file size to megabytes (optional)
            const res = fileSizeInBytes / 1000000.0;
            resolve(res);
        });
    });
}

onmessage = async function(obj) {
    // console.log("get to try Read", obj);
    const filePath = obj.data.filePath;
    const pass = obj.data.pass;
    // console.log("checking file: " + filePath + " with pass: --HIDDEN--");
    // console.log("provided password: " + pass);
    try {
        const fileSize = await getFileSizeInMegabytes(filePath);
        if (fileSize < 2.5) {
            XLSX.readFile(filePath, {
                password: pass,
                bookProps: true,
                // bookSheets: true,
                raw: true,
            });
            postMessage("file-readable");
        } else {
            // console.warn("file is too big skipping password check");
            postMessage("file-too-big");
        }
    } catch (e) {
        // console.warn("cannot read file: " + filePath, e.message);
        if (pass && e.message && e.message === "File is password-protected") {
            const fileSize = await getFileSizeInMegabytes(filePath);
            if (fileSize < 2.5) {
                XlsxPopulate.fromFileAsync(filePath, {password: pass})
                    .then(() => {
                        postMessage("file-readable");
                    })
                    .catch(err => {
                        // console.log(err);
                        postMessage("cannot-read-file");
                    });
            } else {
                // console.warn("file is too big skipping password check");
                postMessage("file-too-big");
            }
        } else if (e.message && e.message === "File is password-protected") {
            postMessage("file-is-password-protected");
        } else {
            // console.error("XlsxPopulate error: " + filePath, e);
            // some error skip pass check
            postMessage("cannot-read-file");
        }
    }
};