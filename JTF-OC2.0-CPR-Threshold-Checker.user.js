// ==UserScript==
// @name         JTF OC2.0 CPR Threshold Checker
// @namespace    https://torn.com/
// @version      0.9
// @description  Shows if you meet faction CPR thresholds for open crime roles on OC recruiting page (SPA-safe, debug-ready)
// @author       SiliconRain
// @match        https://www.torn.com/factions.php?step=your*
// @updateURL    https://raw.githubusercontent.com/SiliconRain/JTF-OC2-Threshold-Checker/refs/heads/main/JTF-OC2.0-CPR-Threshold-Checker.user.js
// @downloadURL  https://raw.githubusercontent.com/SiliconRain/JTF-OC2-Threshold-Checker/refs/heads/main/JTF-OC2.0-CPR-Threshold-Checker.user.js
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    // --- Debugging helpers ---
    const DEBUG = true;
    const log = (...args) => DEBUG && console.log('[JTF OC Thresholds]', ...args);

    const yellowAdjustment = 5; // reduce threshold if crime is paused/expiring

    // --- Threshold table ---
    const thresholds = {
        // Map of crimes -> role thresholds. Supports "All roles" and "All roles unstarted"
        "Ace in the Hole":{
            "Hacker":68,
            "Muscle #2":68,
            "Imitator":64,
            "Muscle #1":64,
            "Driver":58
        },
        "Manifest Cruelty":{
            "All roles":101
        },
        "Stacking the Deck":{
            "Impersonator":72,
            "Hacker":66,
            "Cat Burglar":64,
            "Driver":56
        },
        "Break the Bank":{
            "Muscle #3":69,
            "Thief #2":69,
            "Muscle #1":65,
            "Robber":65,
            "Muscle #2":62,
            "Thief #1":55
        },
        "Clinical Precision":{
            "Cat Burglar":68,
            "Cleaner":68,
            "Imitator":72,
            "Assassin":65
        },
        "Blast from the Past":{
            "Muscle":70,
            "Engineer":70,
            "Bomber":70,
            "Picklock #1":65,
            "Hacker":65,
            "Picklock #2":60
        },
        "Bidding War":{
            "Robber #3":72,
            "Robber #2":68,
            "Bomber #2":68,
            "Driver":65,
            "Bomber #1":60,
            "Robber #1":60
        },
        "Honey Trap":{
            "Muscle #2":70,
            "Muscle #1":65,
            "Enforcer":65
        },
        "Sneaky Git Grab":{
            "Pickpocket":75,
            "Imitator":65,
            "Techie":65,
            "Hacker":62
        },
        "No Reserve":{
            "All roles":70
        },
        "Leave No Trace":{
            "All roles":70,
            "All roles unstarted":65
        },
        "Guardian Ángels":{
            "All roles":70,
            "All roles unstarted":65
        },
        "Counter Offer":{
            "All roles":70,
            "All roles unstarted":65
        },
        "Snow Blind":{
            "All roles":70,
            "All roles unstarted":65
        },
        "Stage Fright":{
            "All roles":70,
            "All roles unstarted":65
        },
        "Market Forces":{
            "All roles":50
        },
        "Smoke and Wing Mirrors":{
            "All roles":50
        },
        "Gaslight the Way":{
            "All roles":65
        },
        "All other crimes":{
            "All roles":45
        }
    };

    // --- Threshold calculation ---
    function getThreshold(crime, level, role, yellow, unstarted) {
        //log("Getting thresholds for:", crime, "-", role);
        const table = thresholds[crime];
        const adjustment = yellow ? yellowAdjustment : 0; // reduce threshold if paused/expiring

        if (table) {
            if (table[role] !== undefined) { // exact match for role
                //log("Exact threshold found:", table[role], "- adjustment:", adjustment);
                return table[role] - adjustment;
            }
            if (unstarted) { // crime hasn't started yet
                if (table["All roles unstarted"] !== undefined) {
                    //log("Unstarted threshold found:", table["All roles unstarted"], "- adjustment:", adjustment);
                    return table["All roles unstarted"] - adjustment;
                } else if (table["All roles"] !== undefined) { // fallback to started threshold
                    //log("Started threshold fallback:", table["All roles"], "- adjustment:", adjustment);
                    return table["All roles"] - adjustment;
                }
            } else if (table["All roles"] !== undefined) { // crime already started
                //log("Started threshold found:", table["All roles"], "- adjustment:", adjustment);
                return table["All roles"] - adjustment;
            }
        }

        // fallback for low-level crimes or undefined thresholds
        if (level < 3) {
            //log("Low-level crime fallback threshold:", thresholds["All other crimes"]["All roles"], "- adjustment:", adjustment);
            return thresholds["All other crimes"]["All roles"] - adjustment;
        }

        //log("No CPR thresholds defined for:", crime);
        return null;
    }

    // --- Main processing function ---
    function processOCPage() {
        log("processOCPage called...");
        const crimeDivs = document.querySelectorAll('div[data-oc-id]'); // select all open crime blocks
        log("Found", crimeDivs.length, "OC blocks");

        crimeDivs.forEach(crimeDiv => {
            const crimeTitleEl = crimeDiv.querySelector('p[class^="panelTitle"]');
            const crimeTitle = crimeTitleEl?.textContent?.normalize("NFKC").replace(/\s+/g,' ').trim();
            if (!crimeTitle) return;

            // Determine crime state (yellow/paused/expiring, not started)
            const crimeIsPaused = crimeDiv.querySelector('div[class^="paused"]');
            const crimeIsExpiring = crimeDiv.querySelector('div[class^="expiring"]');
            const crimeIsYellow = !!(crimeIsPaused || crimeIsExpiring);
            const crimeIsNotStarted = crimeDiv.querySelector('div[class^="recruiting"]');

            const levelEl = crimeDiv.querySelector('[class^="levelValue"]');
            if (!levelEl) { log("No level element found for", crimeTitle); return; }
            const level = parseInt(levelEl.textContent.trim(), 10);

            const slots = crimeDiv.querySelectorAll('[class^="wrapper"][class*="waitingJoin"]');
            slots.forEach(slot => {
                const roleEl = slot.querySelector('[class^="title"]');
                const chanceEl = slot.querySelector('[class^="successChance"]');
                if (!roleEl || !chanceEl) return;

                const role = roleEl.textContent.trim();
                const chance = parseInt(chanceEl.textContent.trim(), 10);
                const min = getThreshold(crimeTitle, level, role, crimeIsYellow, crimeIsNotStarted);

                // Remove old threshold indicators before adding new ones
                slot.querySelectorAll('.oc-threshold').forEach(e => e.remove());

                // Create new threshold note element
                const note = document.createElement('div');
                note.className = 'oc-threshold';
                note.style.fontSize = '12px';
                note.style.fontWeight = 'bold';
                note.style.textAlign = 'center';
                note.style.whiteSpace = 'pre-line';

                if (!min) {
                    note.textContent = `⚠️\nNot yet defined`;
                    note.style.color = 'orange';
                } else if (chance >= min) {
                    note.textContent = `✅ OK\n(Requires ≥ ${min})`;
                    note.style.color = 'limegreen';
                } else {
                    note.textContent = (min==101) ? `❌❌❌\n(Do Not Join!)` : `❌ Too low\n(Requires ≥ ${min})`;
                    note.style.color = '#dd0000';
                }

                slot.prepend(note);
            });
        });
    }

    // --- SPA-safe observer ---
    // Why SPA-safe? Torn uses a single-page app design, meaning page content can change
    // without a full page reload. This code ensures our script runs whenever the relevant
    // DOM elements are added or updated.
    //
    // Note: The DOM is constantly changing, so we add a debounce timeout to throttle the
    // script a bit, the lower the number, the faster the thresholds will populate.
    function waitForOrganizeWrap(callback) {
        const existing = document.querySelector('div.organize-wrap');
        if (existing) {
            log(".organize-wrap already exists");
            callback(existing);
            return;
        }

        // Observe the entire body until the container appears
        log("Waiting for .organize-wrap to appear...");
        const bodyObserver = new MutationObserver((mutations, observer) => {
            const el = document.querySelector('div.organize-wrap');
            if (el) {
                log(".organize-wrap detected via MutationObserver");
                observer.disconnect();
                callback(el);
            }
        });

        bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    waitForOrganizeWrap((organizedWrap) => {
        log("Attaching MutationObserver to .organize-wrap");

        let debounceTimeout;
        const observer = new MutationObserver(() => {
            // Handle DOM changes in the SPA
            log("Mutation detected in .organize-wrap");
            if (debounceTimeout) clearTimeout(debounceTimeout);
            debounceTimeout = setTimeout(() => {
                log("Running processOCPage from observer");
                processOCPage();
            }, 1000); // debounce to avoid rapid multiple runs
        });

        observer.observe(organizedWrap, { childList: true, subtree: true });

        // Initial run when page loads
        processOCPage();
    });

})();