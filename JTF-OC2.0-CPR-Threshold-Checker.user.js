// ==UserScript==
// @name         JTF OC2.0 CPR Threshold Checker
// @namespace    https://torn.com/
// @version      0.4
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
    const log = (...args) => DEBUG && console.log('[OC Tweaks]', ...args);

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
            "Imitator":    68,
            "Assassin":    68,
        },
        "Blast from the Past": {
            "Muscle":      70,
            "Engineer":    70,
            "Bomber":      70,
            "Picklock #1": 65,
            "Hacker":      65,
            "Picklock #2": 60,
        },
        "Honey Trap":             { "All roles": 70 },
        "Bidding War":            { "All roles": 70 },
        "No Reserve":             { "All roles": 70 },
        "Leave No Trace":         { "All roles": 70 },
        "Counter Offer":          { "All roles": 70 },
        "Snow Blind":             { "All roles": 70 },
        "Stage Fright":           { "All roles": 70 },
        "Market Forces":          { "All roles": 50 },
        "Smoke and Wing Mirrors": { "All roles": 50 },
        "Gaslight the Way":       { "All roles": 65 },
        "All other crimes":       { "All roles": 45 },
    };

    const yellowAdjustment = 5;

    function getThreshold(crime, role, paused) {
        log("Getting thresholds for: ",crime," - ",role);
        const table = thresholds[crime];
        const adjustment = paused?yellowAdjustment:0;
        if (table) {
            if (table[role] !== undefined){
                return table[role]-adjustment;
            }
            if (table["All roles"] !== undefined){
                return table["All roles"]-adjustment;
            }
        }
        return thresholds["All other crimes"]["All roles"];
    }

    function processOCPage() {
        log("Processing page...");
        //For each recruiting crime...
        document.querySelectorAll('div[data-oc-id]').forEach(crimeDiv => {
            const crimeTitleEl = crimeDiv.querySelector('p.panelTitle___aoGuV');
            const crimeTitle = crimeTitleEl?.textContent?.trim();
            if (!crimeTitle) return;
            const crimeIsPaused = crimeDiv.querySelector('div.paused___oWz6S');
            log("Found crime - ",crimeTitle);
            //For each open slot in the crime...
            crimeDiv.querySelectorAll('.wrapper___Lpz_D.waitingJoin___jq10k').forEach(slot => {
                const roleEl = slot.querySelector('.title___UqFNy');
                const chanceEl = slot.querySelector('.successChance___ddHsR');
                if (!roleEl || !chanceEl) return;
                const role = roleEl.textContent.trim();
                const chance = parseInt(chanceEl.textContent.trim(), 10);
                var min = getThreshold(crimeTitle, role, crimeIsPaused);
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

    const target = document.querySelector(".tt-oc2-list") || document.body;
    let processTimeout;
    const obs = new MutationObserver(() => {
        clearTimeout(processTimeout);
        processTimeout = setTimeout(processOCPage, 1000);
        obs.disconnect(); // stop watching
    });
    obs.observe(target, { childList: true, subtree: true });

// Initial run
log("Initial run...");
processOCPage();

})();
