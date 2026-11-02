import assert from "node:assert/strict";
import {formatDocumentMoney} from "../shared/document-money";

assert.equal(formatDocumentMoney("21.40","USD"),"USD 21.40");
assert.equal(formatDocumentMoney("9007199254740993.123456","EUR"),"EUR 9007199254740993.123456");
assert.equal(formatDocumentMoney("0.000001","ZAR"),"ZAR 0.000001");
assert.equal(formatDocumentMoney("-4.25","GBP"),"GBP -4.25");
assert.equal(formatDocumentMoney("0","ZAR"),"ZAR 0");
assert.match(formatDocumentMoney("12",null),/currency is missing/);
assert.match(formatDocumentMoney("12"," "),/currency is missing/);
assert.match(formatDocumentMoney(null,"USD"),/amount is missing or invalid/);
assert.match(formatDocumentMoney("NaN","USD"),/amount is missing or invalid/);
assert.match(formatDocumentMoney("Infinity","USD"),/amount is missing or invalid/);
assert.match(formatDocumentMoney("1e6","USD"),/amount is missing or invalid/);
assert.equal(formatDocumentMoney("01.2300"," USD "),"USD 01.2300");
console.log("Document-money checks passed: original currency and exact precision preserved; missing evidence is not substituted.");
