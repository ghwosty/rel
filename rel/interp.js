const requires = require("./requires")
const fs = requires.fs;
const path = requires.path;
const manager = requires.manager;
const errors = require("./errors");
const handlers = require("./handlers");
const variables = require("./variables");
const { exec } = require("child_process");


async function interp(file) {
    const fd = fs.readFileSync(file, "utf8")
    const flines = fd.split("\n")

    const mainFound = await checkForMain(file);
    mainFound ? handlers.wl("Main function found") : errors.throwMainNotFound(file.replace(/\.[^/.]+$/, ""), file);
    if (!mainFound) return;

    const mainEnds = await manager.checkForEnd(file.replace(/\.[^/.]+$/, ""), fd);
    if (!mainEnds) errors.throwUED(file.replace(/\.[^/.]+$/, ""), file)

    var readingFunction = false;
    var executingFunction = false;
    var iffs = [];

    var pastVoid = false;

    async function ia(start) {
        if (!start) start = 0;
        for (let i = start; i < flines.length; i++) {
            if (flines[i].trim().endsWith(";")) errors.throwSyntax(";", file)
            const line = flines[i].replaceAll("\r", "").trim();

            if (line == "") continue;

            else if (line.includes("}(")) {
                if (readingFunction || executingFunction) {
                    if (readingFunction == line.split("(")[1].replace(")", "") || executingFunction.toString().trim() == line.split("(")[1].replace(")", "").trim()) {
                        readingFunction = false;
                        if (executingFunction) ia(parseInt(i + 1))
                        if (executingFunction) return executingFunction = false;
                    }
                }
            }

            else if (readingFunction) continue;

            else if (line.startsWith("#") || line.startsWith("//")) continue; // comments

            else if (line.i("void ")) {
                if (executingFunction == line.split("void ")[1].replace(line.split("void ")[1].split("(")[1], "").replace("(", "")) continue;

                // if (executingFunction) continue;
                var a = line.split("void ")[1];
                if (a.i("(")) a = a.replace(a.split("(")[1], "").replace("(", "");
                readingFunction = a

                const ended = await manager.checkForEnd(readingFunction, fd);

                if (!ended) errors.throwUED(readingFunction, file);
            }

            /*else if (executingFunction) {
                if (!line.i("void ")) {
                    console.log(line, pastVoid)
                    if (!line.i(executingFunction) && !pastVoid) {
                        // console.log(line)
                        continue;
                    } else {
                        console.log("PASSED:", line)
                    }
                }
            }*/

            else if (line.i("public " + file.replace(/\.[^/.]+$/, ""))) continue;

            else if (line.i("if (")) {
                var o1 = line.split("(")[1].replace(line.split(")")[1].replace("(", ""), "").replace(")", "").replace("{", "").trim()
                //console.log("IF OPTIONS:", o1, o1.length)

                const ofunc = line.split(")")[1].replace("(", "").trim()

                if (iffs.includes(i)) continue;

                if (o1 == "true") {
                    executingFunction = ofunc.trim();
                    iffs.push(i)
                    if (executingFunction == "") errors.throwTypeError("()", i, file)
                    ia(i);
                    return;
                }

                if (o1.length == 1) {
                    // handle truthy values
                    if (manager.isVariable(o1)) {
                        const value = variables.getVariable(o1);
                        if (value) {
                            if (executingFunction == ofunc.trim()) continue;
                            executingFunction = ofunc.trim();
                            iffs.push(i)
                            if (executingFunction == "") errors.throwTypeError("()", i, file)
                            ia(i);
                        }
                    } else {
                        if (o1) {
                            if (executingFunction != ofunc.trim()) {
                                executingFunction = ofunc.trim();
                                iffs.push(i)
                                if (executingFunction == "") errors.throwTypeError("()", i, file)
                                ia(i);
                            }
                        }
                    }
                } else {
                    var sideOne = o1.split(' ')[0]
                    const comparisonExpression = o1.split('==').map(expr => expr.trim());
                    const comparisonOperator = '==';
                    let comparisonValue = comparisonExpression[1]

                    if (manager.isVariable(sideOne)) sideOne = variables.getVariable(sideOne)
                    if (manager.isVariable(comparisonValue)) comparisonValue = variables.getVariable(comparisonValue)

                    if (manager.isVariable(sideOne)) sideOne = `"${sideOne}"`
                    if (manager.isVariable(comparisonValue)) comparisonValue = `"${comparisonValue}"`

                    //o1 = `${variableValue} ${comparisonOperator} ${quoteChar}${comparisonValue}${quoteChar}`;

                    let comparisonResult;
                    if (comparisonOperator === '==') {
                        comparisonResult = sideOne == comparisonValue;
                    } else if (comparisonOperator === '!=') {
                        comparisonResult = sideOne != comparisonValue;
                    } else if (comparisonOperator === '<') {
                        comparisonResult = sideOne < comparisonValue;
                    } else if (comparisonOperator === '>') {
                        comparisonResult = sideOne > comparisonValue;
                    } else if (comparisonOperator === '<=') {
                        comparisonResult = sideOne <= comparisonValue;
                    } else if (comparisonOperator === '>=') {
                        comparisonResult = sideOne >= comparisonValue;
                    }

                    if (comparisonResult) {
                        executingFunction = ofunc.trim();
                        iffs.push(i)
                        if (executingFunction == "") errors.throwTypeError("()", i, file)
                        return ia(i);
                    }
                }
                continue;
            }

            else if (line.i("using ")) await manager.use(line.split(" ")[1], i, file);

            else if (line.startsWith("define ")) {
                await variables.putVariable(line.split(" ")[1], line.split("=")[1].trim(), file, i);
            }

            else if (line.i(".")) await manager.handleFunction(line, i, file);

            else if (line.i("(") && line.endsWith(")") && !line.i("}") && !line.i("if")) {
                if (executingFunction != line.substring(0, line.indexOf("(")).trim()) {
                    executingFunction = line.substring(0, line.indexOf("(")).trim();
                    if (executingFunction == "") errors.throwTypeError("()", i, file)
                    return ia(i);
                }
            }

            else errors.throwTypeError(line, i, file)

            if (i == flines.length - 1) return true;

        }

    }

    ia();

    return true;
}

function checkForMain(fname) {
    const fd = fs.readFileSync(fname, "utf8");
    return fd.includes("public " + fname.replace(/\.[^/.]+$/, ""));
}

function ef(fname) {
    executingFunction = fname.trim();
    if (executingFunction == "") errors.throwTypeError("()", i, file)
    ia();
}

String.prototype.i = function (s) {
    return this.includes(s);
}

module.exports = { interp, ef }