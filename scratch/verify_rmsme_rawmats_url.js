import https from 'https';

const routes = [
    "https://rmsme-rawmats.web.app/RMIMS/index.html",
    "https://rmsme-rawmats.web.app/RMIMS/login.html",
    "https://rmsme-rawmats.web.app/RMIMS/user-signin.html",
    "https://rmsme-rawmats.web.app/RMIMS/admin/dashboard.html",
    "https://rmsme-rawmats.web.app/RMIMS/user/dashboard.html",
    "https://rmsme-rawmats.web.app/RMIMS/admin/inventory.html",
    "https://rmsme-rawmats.web.app/RMIMS/user/inventory.html",
    "https://rmsme-rawmats.web.app/RMIMS/admin/material-activity.html",
    "https://rmsme-rawmats.web.app/RMIMS/admin/analytics.html",
    "https://rmsme-rawmats.web.app/RMIMS/admin/forecasting.html",
    "https://rmsme-rawmats.web.app/RMIMS/admin/reports.html",
    "https://rmsme-rawmats.web.app/RMIMS/admin/settings.html",
    "https://rmsme-rawmats.web.app/RMIMS/assets/logo-icon.png",
    "https://rmsme-rawmats.web.app/RMIMS/assets/rmsme-3d-logo.png"
];

function checkUrl(url) {
    return new Promise((resolve) => {
        https.get(url, (res) => {
            console.log(`[PASS ${res.statusCode} ${res.statusMessage}] ${url}`);
            resolve(res.statusCode === 200);
        }).on('error', (err) => {
            console.error(`[FAIL] ${url} - ${err.message}`);
            resolve(false);
        });
    });
}

async function verifyAll() {
    console.log("====================================================");
    console.log("VERIFYING NEW SITE: rmsme-rawmats.web.app");
    console.log("====================================================");
    let success = true;
    for (const url of routes) {
        const ok = await checkUrl(url);
        if (!ok) success = false;
    }
    console.log("====================================================");
    if (success) {
        console.log("ALL PUBLIC HTTPS ROUTES VERIFIED 100% SUCCESSFUL!");
        console.log("PRIMARY LINK: https://rmsme-rawmats.web.app/RMIMS/index.html");
    }
    console.log("====================================================");
}

verifyAll();
