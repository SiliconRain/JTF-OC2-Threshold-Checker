// ==UserScript==
// @name         JTF OC2.0 CPR Threshold Checker
// @namespace    https://torn.com/
// @version      0.8
// @description  Shows if you meet faction CPR thresholds for open crime roles on OC recruiting page
// @author       SiliconRain
// @match        https://www.torn.com/factions.php?step=your*
// @updateURL    https://raw.githubusercontent.com/SiliconRain/JTF-OC2-Threshold-Checker/refs/heads/main/JTF-OC2.0-CPR-Threshold-Checker.user.js
// @downloadURL  https://raw.githubusercontent.com/SiliconRain/JTF-OC2-Threshold-Checker/refs/heads/main/JTF-OC2.0-CPR-Threshold-Checker.user.js
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    //Globals:
    //----------------
    const DEBUG = false;
    const log = (...args) => DEBUG && console.log('[JTF OC Thresholds]', ...args);
    const yellowAdjustment = 5;
    const UNKNOWN_THRESHOLD = -1;

    // Thresholds table from Google sheets - published as a CSV
    const THRESHOLDS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSYqL3ZcxOPexCFM5LcmnEu_mBNfWD1P5k6xTOAHVKFhQaHGUdU24y3Oh1O1sxzpTqEEBBV3kE8bi6L/pub?output=csv";
    let sheetThresholds = null;
    let thresholdsLoaded = false;
    //----------------

    async function loadThresholdsFromSheet() {
        if (thresholdsLoaded) return sheetThresholds;
    
        try {
            const response = await fetch(THRESHOLDS_CSV_URL);
            const csvText = await response.text();
    
            sheetThresholds = parseThresholdCSV(csvText);
            thresholdsLoaded = true;
    
            console.log("[JTF OC Thresholds] Thresholds loaded from Google Sheets");
            return sheetThresholds;
    
        } catch (err) {
            console.error("[JTF OC Thresholds] Failed to load thresholds", err);
            return null;
        }
    }

    function parseThresholdCSV(csvText) {
        const lines = csvText.trim().split("\n");
        const headers = lines.shift().split(",").map(h => h.trim());
        const rows = lines.map(line => {
            const values = line.split(",").map(v => v.trim());
            const row = {};
            headers.forEach((h, i) => row[h] = values[i] || "");
            return row;
        });
    
        return rows;
    }

    async function getThreshold(crime, level, role, isYellow, isNotStarted) {
        log("Getting thresholds for: ",crime," - ",role);
        const adjustment = isYellow ? yellowAdjustment : 0;//if isYellow is true, we will adjust all thresholds by the value of the global 'yellowAdjustment' 
        const rows = await loadThresholdsFromSheet();
        if (!rows){
            log("!!! No rows were found in the threshold sheet! Something went wrong !!!");
            return null;
        }
        
        // 1. Exact crime + exact role
        let match = rows.find(r =>
            r.Crime === crime &&
            r.Role === role
        );
        if(match) log("Scenario A: Threshold for ",role," in ",crime," found to be ",match.DefaultThreshold);

    
        // 2. Exact crime + All roles
        if (!match) {
            match = rows.find(r =>
                r.Crime === crime &&
                r.Role === "All roles"
            );
        }
        if(match) log("Scenario B: Threshold for ",role," not found in ",crime,", so using all-roles threshold of ",match.DefaultThreshold);

        // 3. All other crimes fallback (optional)
        if (!match && level<=2) {
            match = rows.find(r =>
                r.Crime === "All other crimes" &&
                r.Role === "All roles"
            );
        }
    
        if (!match){
            log("Scenario E: no thresholds found for ",crime,", and the level is above 2, so returning UNKNOWN_THRESHOLD");
            return UNKNOWN_THRESHOLD;
        }
    
        if (isNotStarted && match.UnstartedThreshold != null) {
            log("Scenario D: no thresholds found for ",crime,", the level is 1 or 2 AND the crime is unstarted, so using all-roles unstarted threshold of ",match.UnstartedThreshold);
            return Number(match.UnstartedThreshold)-adjustment;
        }

        log("Scenario C: no thresholds found for ",crime,", and the level is 1 or 2, so using all-roles threshold of ",match.DefaultThreshold);
        return Number(match.DefaultThreshold)-adjustment;
    }
    
    async function processOCPage() {
        log("Processing page...");
        //For each recruiting crime...
        for (const crimeDiv of document.querySelectorAll('div[data-oc-id]')) {
            const crimeTitleEl = crimeDiv.querySelector('p.panelTitle___aoGuV');
            const crimeTitle = crimeTitleEl?.textContent
            ?.normalize("NFKC") // normalize Unicode
            .replace(/\s+/g, ' ') // normalize all whitespace
            .trim();

            if (!crimeTitle) return;
            log("Found crime - ",crimeTitle);
            const crimeIsPaused = crimeDiv.querySelector('div.paused___oWz6S');
            const crimeIsExpiring = crimeDiv.querySelector('div.expiring___u6hcI');
            const crimeIsYellow = !!(crimeIsPaused || crimeIsExpiring);
            log("Crime is yellow? ",crimeIsYellow);
            const crimeIsNotStarted = crimeDiv.querySelector('div.recruiting___bFcBU');
            log("CrimeIsNotStarted is: ",crimeIsNotStarted);

            //Scrape the level of the crime
            const levelEl = crimeDiv.querySelector('.levelValue___TE4qC');
            const level = parseInt(levelEl.textContent.trim(), 10);
            log("Crime level is: ",level);

            //For each open slot in the crime...
            for (const slot of crimeDiv.querySelectorAll('.wrapper___Lpz_D.waitingJoin___jq10k')) {
                const roleEl = slot.querySelector('.title___UqFNy');
                const chanceEl = slot.querySelector('.successChance___ddHsR');
                if (!roleEl || !chanceEl) return;
                const role = roleEl.textContent.trim();
                const chance = parseInt(chanceEl.textContent.trim(), 10);
                var min = await getThreshold(crimeTitle, level, role, crimeIsYellow, crimeIsNotStarted);
                log("Found open role - ",crimeTitle,", ",role,", with success chance ",chance," and threshold ",min);
                slot.querySelectorAll('.oc-threshold').forEach(e => e.remove());
                const note = document.createElement('div');
                note.className = 'oc-threshold';
                note.style.fontSize = '12px';
                note.style.fontWeight = 'bold';
                note.style.textAlign = 'center';
                if(min === null) { // If min is null, something went wrong with getting the threshold from the published CSV, so bail out
                    log(">> There was an error looking up the threshold for ",crimeTitle,", ",role,". Bailing out and moving to the next slot..."); 
                    return;
                }
                if (min === UNKNOWN_THRESHOLD){
                    //if min is UNKNOWN_THRESHOLD, then we don't know what the CPR thresholds for this crime are
                    note.textContent = `⚠️\nNot yet defined`;
                    note.style.color = 'orange';
                    note.style.whiteSpace = 'pre-line';
                }else{
                    if (chance >= min) {
                        //if the CPR pass rate is greater than or equal to the threshold for this crime role
                        note.textContent = `✅ OK\n(Requires ≥ ${min})`;
                        note.style.whiteSpace = 'pre-line';
                        note.style.color = 'limegreen';
                    } else {
                        //if the CPR pass rate is less than the threshold for this crime role
                        note.textContent = (min===101) ? (`❌❌❌\n(Do Not Join!)`) : (`❌ Too low\n(Requires ≥ ${min})`);
                        note.style.whiteSpace = 'pre-line';
                        note.style.color = '#dd0000';
                    }
                }
                slot.prepend(note);
            });
        });
    }

    // Wait until at least one OC block appears
    function waitForOCContent() {
        if (document.querySelector('div[data-oc-id]')) {
            log("OC content detected. Running processOCPage...");
            processOCPage();
            return; // stop – content is ready
        }

        // If not ready, keep watching
        const observer = new MutationObserver(() => {
            if (document.querySelector('div[data-oc-id]')) {
                log("OC content appeared via MutationObserver. Running processOCPage...");
                observer.disconnect();
                processOCPage();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

//Add event handler to "Recruiting" button to re-run the script if switching from another tab on the OCs page
const recruitingButton = document.querySelector('button.button___cwmLf')
recruitingButton.addEventListener("click", function (e) {
    setTimeout(function(){processOCPage();}, 1000);
});
// Run the loader
waitForOCContent();

})();
