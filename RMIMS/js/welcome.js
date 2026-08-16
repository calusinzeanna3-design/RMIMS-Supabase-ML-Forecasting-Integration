const timeEl = document.getElementById("clockTime");
const dateEl = document.getElementById("clockDate");

const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function pad(n) {
    return n < 10 ? "0" + n : "" + n;
}

function updateClock() {
    const now = new Date();

    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    if (timeEl) timeEl.textContent = `${hours}:${minutes}`;

    const dayOfMonth = now.getDate();
    const month = monthNames[now.getMonth()];
    const dayName = dayNames[now.getDay()];
    if (dateEl) dateEl.innerHTML = `${dayOfMonth} ${month}<br>${dayName}`;
}

updateClock();
setInterval(updateClock, 1000 * 15);
