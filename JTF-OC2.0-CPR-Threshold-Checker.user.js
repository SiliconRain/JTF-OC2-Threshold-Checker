// ==UserScript==
// @name         JTF OC2.0 CPR Threshold Checker
// @namespace    https://torn.com/
// @version      1.1
// @description  Shows if you meet faction CPR thresholds for open crime roles on OC recruiting page (SPA-safe, debug-ready)
// @author       SiliconRain
// @match        https://www.torn.com/factions.php?step=your*
// @updateURL    https://raw.githubusercontent.com/SiliconRain/JTF-OC2-Threshold-Checker/refs/heads/main/JTF-OC2.0-CPR-Threshold-Checker.user.js
// @downloadURL  https://raw.githubusercontent.com/SiliconRain/JTF-OC2-Threshold-Checker/refs/heads/main/JTF-OC2.0-CPR-Threshold-Checker.user.js
// @grant        GM_xmlhttpRequest
// @connect      docs.google.com
// @connect      googleusercontent.com
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    // --- Debugging helpers ---
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

        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: THRESHOLDS_CSV_URL,
                onload: (response) => {
                    try {
                        sheetThresholds = parseThresholdCSV(response.responseText);
                        thresholdsLoaded = true;
                        console.log("[JTF OC Thresholds] Thresholds loaded from Google Sheets");
                        resolve(sheetThresholds);
                    } catch (err) {
                        console.error("[JTF OC Thresholds] Failed to parse thresholds", err);
                        resolve(null);
                    }
                },
                onerror: (err) => {
                    console.error("[JTF OC Thresholds] Failed to load thresholds", err);
                    resolve(null);
                }
            });
        });
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
        if (!match) {
            match = rows.find(r =>
                r.Crime === "All other crimes" &&
                r.Role === "All roles"
            );
            if (!match){
                log("!!!! Uh oh -  A default 'all other crimes' fallback was not found in the thresholds CSV!");
                return null;
            }
            if(level>2){
                log("Scenario D: no thresholds found for ",crime,", and the level is above 2, so returning UNKNOWN_THRESHOLD (value: ",UNKNOWN_THRESHOLD,")");
                return UNKNOWN_THRESHOLD;
            }
            log("Scenario C: no thresholds found for ",crime,", and the level is 1 or 2, so returning the 'All other crimes' threshold");
        }

        if (isNotStarted && match.UnstartedThreshold != "") {
            log("Crime ",crime,", is unstarted and there is an unstarted override threshold for this crime and role, so returning the unstarted threshold of ",match.UnstartedThreshold,"-",adjustment);
            return Number(match.UnstartedThreshold)-adjustment;
        }
        log("Crime ",crime,", is either started or and there is no unstarted override threshold for this crime and role, so returning the default threshold of ",match.DefaultThreshold,"-",adjustment);
        return Number(match.DefaultThreshold)-adjustment;
    }

    function showLoadingBanner(container) {
        const existing = document.getElementById('oc-threshold-loading');
        if (existing) return existing;

        const banner = document.createElement('div');
        banner.id = 'oc-threshold-loading';
        banner.textContent = 'Loading JTF OC Thresholds...';
        banner.style.background = '#1f1f1f';
        banner.style.color = '#ccc';
        banner.style.padding = '8px';
        banner.style.marginBottom = '10px';
        banner.style.textAlign = 'center';
        banner.style.fontWeight = 'bold';
        banner.style.border = '1px solid #333';
        banner.style.borderRadius = '4px';

        container.prepend(banner);
        return banner;
    }

    function removeLoadingBanner() {
        const banner = document.getElementById('oc-threshold-loading');
        if (banner) banner.remove();
    }

    async function processOCPage() {
        log("Processing page...");
        //For each recruiting crime...
        for (const crimeDiv of document.querySelectorAll('div[data-oc-id]')) {
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

            //const slots = crimeDiv.querySelectorAll('[class^="wrapper"][class*="waitingJoin"]');
            //slots.forEach(slot => {
            for (const slot of crimeDiv.querySelectorAll('[class^="wrapper"][class*="waitingJoin"]')) {
                const roleEl = slot.querySelector('[class^="title"]');
                const chanceEl = slot.querySelector('[class^="successChance"]');
                if (!roleEl || !chanceEl) return;

                const role = roleEl.textContent.trim();
                const chance = parseInt(chanceEl.textContent.trim(), 10);
                var min = await getThreshold(crimeTitle, level, role, crimeIsYellow, crimeIsNotStarted);
                log("Found open role - ",crimeTitle,", ",role,", with success chance ",chance," and threshold ",min);
                slot.querySelectorAll('.oc-threshold').forEach(e => e.remove());

                // Create new threshold note element
                const note = document.createElement('div');
                note.className = 'oc-threshold';
                note.style.fontSize = '12px';
                note.style.fontWeight = 'bold';
                note.style.textAlign = 'center';
                note.style.whiteSpace = 'pre-line';

                if(min === null) { // If min is null, something went wrong with getting the threshold from the published CSV, so bail out
                    log(">> There was an error looking up the threshold for ",crimeTitle,", ",role,". Bailing out and moving to the next slot...");
                    return;
                }
                if (min === UNKNOWN_THRESHOLD){
                    note.textContent = `⚠️\nNot yet defined`;
                    note.style.color = 'orange';
                } else if (chance >= min) {
                    note.textContent = `✅ OK\n(Requires ≥ ${min})`;
                    note.style.color = 'limegreen';
                } else {
                    note.textContent = (min==101) ? `❌❌❌\n(Do Not Join!)` : `❌ Too low\n(Requires ≥ ${min})`;
                    note.style.color = '#cc0000';
                }

                slot.prepend(note);
            };
        };
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
        // Show loading banner immediately
        const banner = showLoadingBanner(organizedWrap);

        // Ensure thresholds are loaded first
        loadThresholdsFromSheet().then(() => {
            removeLoadingBanner();
            processOCPage();
        });
    });

})();
