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

    const DEBUG = false;
    const log = (...args) => DEBUG && console.log('[JTF OC Thresholds]', ...args);

    // Thresholds table
    const thresholds = {
        "Ace in the Hole":{
            "Hacker":     68,
            "Muscle #2":  68,
            "Imitator":   64,
            "Muscle #1":  64,
            "Driver":     58
        },
        "Manifest Cruelty": { "All roles": 101 },
        "Stacking the Deck":{
            "Impersonator": 72,
            "Hacker":       66,
            "Cat Burglar":  64,
            "Driver":       56
        },
        "Break the Bank": {
            "Muscle #3": 69,
            "Thief #2":  69,
            "Muscle #1": 65,
            "Robber":    65,
            "Muscle #2": 62,
            "Thief #1":  55,
        },
        "Clinical Precision": {
            "Cat Burglar": 68,
            "Cleaner":     68,
            "Imitator":    72,
            "Assassin":    65,
        },
        "Blast from the Past": {
            "Muscle":      70,
            "Engineer":    70,
            "Bomber":      70,
            "Picklock #1": 65,
            "Hacker":      65,
            "Picklock #2": 60,
        },
        "Bidding War": {
            "Robber #3": 72,
            "Robber #2": 68,
            "Bomber #2": 68,
            "Driver":    65,
            "Bomber #1": 60,
            "Robber #1": 60,
        },
        "Honey Trap": {
            "Muscle #2":    70,
            "Muscle #1":    65,
            "Enforcer":     65
        },
        "Sneaky Git Grab": {
            "Pickpocket":  75,
            "Imitator":    65,
            "Techie":      65,
            "Hacker":      62
        },
        "No Reserve":             { "All roles": 70 },
        "Leave No Trace":         { "All roles": 70, "All roles unstarted":65},
        "Guardian Ángels":        { "All roles": 70, "All roles unstarted":65},
        "Counter Offer":          { "All roles": 70, "All roles unstarted":65},
        "Snow Blind":             { "All roles": 70, "All roles unstarted":65},
        "Stage Fright":           { "All roles": 70, "All roles unstarted":65},
        "Market Forces":          { "All roles": 50 },
        "Smoke and Wing Mirrors": { "All roles": 50 },
        "Gaslight the Way":       { "All roles": 65 },
        "All other crimes":       { "All roles": 45 },
    };

    const yellowAdjustment = 5;

    function getThreshold(crime, level, role, yellow, unstarted) {
        log("Getting thresholds for: ",crime," - ",role);
        const table = thresholds[crime];
        const adjustment = yellow?yellowAdjustment:0;

        if (table) {
            //if the crime was found in the threshold table, try and lookup a threshold for the role in this crime
            log("Threshold table found for: ",crime," - looking up role value...");
            if (table[role] !== undefined){
                //if the role name was found in the table for this crime, return it minus any adjustment for yellow crimes
                log("A: Threshold for: ",crime," found to be exactly ",table[role]," and will be adjusted by -",adjustment);
                return table[role]-adjustment;
            }
            //if the crime was found but the role was not...
            if (unstarted){
                //if the crime is unstarted, check if there is an alternate threshold for unstarted crimes of this type
                if (table["All roles unstarted"] !== undefined){
                    log("B: Threshold for this role (",role,") in unstarted crime: ",crime," was not found, so defaulting to special unstarted value of ",table["All roles"]," and will be adjusted by -",adjustment);
                    return table["All roles unstarted"]-adjustment;
                }else{
                    log("C: Threshold for this role (",role,") in unstarted crime: ",crime," was not found, so defaulting to ",table["All roles"]," and will be adjusted by -",adjustment);
                    return table["All roles"]-adjustment;
                }
            }else{
                //if there was no alternate threshold for unstarted crimes, return the "all roles" threshold for this crime
                if (table["All roles"] !== undefined){
                    log("D: Threshold for the started crime: ",crime," found to be ",table["All roles"]," and will be adjusted by -",adjustment);
                    return table["All roles"]-adjustment;
                }
            }
        }
        //if the crime was not found in the lookup table...
        if(level<3){
            //if this is a low-level crime, return the "All other crimes" threshold value
            log("E: Threshold for: ",crime," was not found so is defaulted to ",thresholds["All other crimes"]["All roles"]," and will be adjusted by -",adjustment);
            return thresholds["All other crimes"]["All roles"]-adjustment;
        }else{
            //if this crime is level three or higher, return null to indicate we do not know what the thresholds for this crime should be
             log("F: No CPR thresholds defined for: ",crime,", so returning null");
            return null;
        }
    }

    function processOCPage() {
        log("Processing page...");
        //For each recruiting crime...
        document.querySelectorAll('div[data-oc-id]').forEach(crimeDiv => {
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
            crimeDiv.querySelectorAll('.wrapper___Lpz_D.waitingJoin___jq10k').forEach(slot => {
                const roleEl = slot.querySelector('.title___UqFNy');
                const chanceEl = slot.querySelector('.successChance___ddHsR');
                if (!roleEl || !chanceEl) return;
                const role = roleEl.textContent.trim();
                const chance = parseInt(chanceEl.textContent.trim(), 10);
                var min = getThreshold(crimeTitle, level, role, crimeIsYellow, crimeIsNotStarted);
                log("Found open role - ",crimeTitle,", ",role,", with success chance ",chance," and threshold ",min);
                slot.querySelectorAll('.oc-threshold').forEach(e => e.remove());
                const note = document.createElement('div');
                note.className = 'oc-threshold';
                note.style.fontSize = '12px';
                note.style.fontWeight = 'bold';
                note.style.textAlign = 'center';
                if (!min){
                    //if min is null, then we don't know what the CPR thresholds for this crime are
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
                        note.textContent = (min==101) ? (`❌❌❌\n(Do Not Join!)`) : (`❌ Too low\n(Requires ≥ ${min})`);
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
