import path from "node:path";
/** A green release gate must not hide skipped or never-executed tests. */
export default class ReleaseCompletenessReporter {
  onBegin(_config, suite) {
    this.suite = suite;
  }

  onEnd() {
    const tests = this.suite?.allTests() ?? [];
    let missingFiles=[];
    if(process.env.PLAYWRIGHT_EXPECTED_SPECS) {
      try {
        const expected=JSON.parse(process.env.PLAYWRIGHT_EXPECTED_SPECS);
        if(!Array.isArray(expected)||!expected.every(item=>typeof item==="string"))throw new Error();
        const normalize=file=>path.resolve(file).toLowerCase();
        const observed=new Set(tests.filter(test=>test.location?.file).map(test=>normalize(test.location.file)));
        missingFiles=expected.filter(file=>!observed.has(normalize(file)));
      }catch{console.error("Release spec manifest is invalid.");return {status:"failed"};}
    }
    const incomplete = tests.filter((test) =>
      test.results.length === 0 || test.results.every((result) => result.status === "skipped") ||
      test.expectedStatus === "failed" ||
      (test.results.some((result) => result.status === "passed") && test.results.some((result) => ["failed","timedOut","interrupted"].includes(result.status))));
    if (tests.length === 0 || incomplete.length > 0 || missingFiles.length>0) {
      console.error(`[release completeness] ${incomplete.length} incomplete, expected-failure or unstable tests out of ${tests.length}. Exclusions require a separately documented gate; this run cannot sign off.`);
      for (const test of incomplete) console.error(`  ${test.titlePath().join(" > ")}`);
      for(const file of missingFiles)console.error(`  Requested spec did not execute: ${file}`);
      return { status: "failed" };
    }
  }
}
