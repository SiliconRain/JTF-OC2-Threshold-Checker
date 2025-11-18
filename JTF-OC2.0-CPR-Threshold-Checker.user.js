// ==UserScript==
// @name         JTF OC2.0 CPR Threshold Checker
// @namespace    https://torn.com/
// @version      0.5
// @description  Shows if you meet faction CPR thresholds for open crime roles on OC recruiting page
// @author       SiliconRain
// @match        https://www.torn.com/factions.php?step=your*
// @updateURL    https://raw.githubusercontent.com/SiliconRain/JTF-OC2-Threshold-Checker/refs/heads/main/JTF-OC2.0-CPR-Threshold-Checker.user.js
// @downloadURL  https://raw.githubusercontent.com/SiliconRain/JTF-OC2-Threshold-Checker/refs/heads/main/JTF-OC2.0-CPR-Threshold-Checker.user.js
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const DEBUG = true;
    const log = (...args) => DEBUG && console.log('[JTF OC Thresholds]', ...args);

    // Thresholds table
    const thresholds = {
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
        "Honey Trap":             { "All roles": 70, "All roles unstarted":65},
        "Bidding War":            { "All roles": 70 },
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

    function getThreshold(crime, role, yellow, unstarted) {
        log("Getting thresholds for: ",crime," - ",role);
        const table = thresholds[crime];
        const adjustment = yellow?yellowAdjustment:0;
        if (table) {
            if (table[role] !== undefined){
                log("Threshold for: ",crime," found to be exactly ",table[role]," and will be adjusted by -",adjustment);
                return table[role]-adjustment;
            }
            if (unstarted){
                if (table["All roles unstarted"] !== undefined){
                    log("Threshold for the unstarted crime: ",crime," found to be ",table["All roles unstarted"]," and will be adjusted by -",adjustment);
                    return table["All roles unstarted"]-adjustment;
                }
            }else{
                if (table["All roles"] !== undefined){
                    log("Threshold for the started crime: ",crime," found to be ",table["All roles"]," and will be adjusted by -",adjustment);
                    return table["All roles"]-adjustment;
                }
            }
        }
        log("Threshold for: ",crime," was not found so is defaulted to ",thresholds["All other crimes"]["All roles"]," and will be adjusted by -",adjustment);
        return thresholds["All other crimes"]["All roles"]-adjustment;
    }

    function processOCPage() {
        log("Processing page...");
        //For each recruiting crime...
        document.querySelectorAll('div[data-oc-id]').forEach(crimeDiv => {
            const crimeTitleEl = crimeDiv.querySelector('p.panelTitle___aoGuV');
            const crimeTitle = crimeTitleEl?.textContent?.trim();
            if (!crimeTitle) return;
            log("Found crime - ",crimeTitle);
            const crimeIsPaused = crimeDiv.querySelector('div.paused___oWz6S');
            const crimeIsExpiring = crimeDiv.querySelector('div.expiring___u6hcI');
            const crimeIsYellow = !!(crimeIsPaused || crimeIsExpiring);
            log("Crime is yellow? ",crimeIsYellow);
            const crimeIsNotStarted = crimeDiv.querySelector('div.recruiting___bFcBU');
            log("CrimeIsNotStarted is: ",crimeIsNotStarted);
            //For each open slot in the crime...
            crimeDiv.querySelectorAll('.wrapper___Lpz_D.waitingJoin___jq10k').forEach(slot => {
                const roleEl = slot.querySelector('.title___UqFNy');
                const chanceEl = slot.querySelector('.successChance___ddHsR');
                if (!roleEl || !chanceEl) return;
                const role = roleEl.textContent.trim();
                const chance = parseInt(chanceEl.textContent.trim(), 10);
                var min = getThreshold(crimeTitle, role, crimeIsYellow, crimeIsNotStarted);
                log("Found open role - ",crimeTitle,", ",role,", with success chance ",chance," and threshold ",min);
                slot.querySelectorAll('.oc-threshold').forEach(e => e.remove());
                const note = document.createElement('div');
                note.className = 'oc-threshold';
                note.style.fontSize = '12px';
                note.style.fontWeight = 'bold';
                note.style.textAlign = 'center';
                if (chance >= min) {
                    note.textContent = `✅ OK\n(Requires ≥ ${min})`;
                    note.style.whiteSpace = 'pre-line';
                    note.style.color = 'limegreen';
                } else {
                    note.textContent = `❌ Too low\n(Requires ≥ ${min})`;
                    note.style.whiteSpace = 'pre-line';
                    note.style.color = 'red';
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

// Run the loader
waitForOCContent();
})();
