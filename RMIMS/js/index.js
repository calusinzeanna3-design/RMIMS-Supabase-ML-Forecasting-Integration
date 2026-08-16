const stage = document.getElementById("rmStage");
const cardAdmin = document.getElementById("cardAdmin");
const cardUser = document.getElementById("cardUser");

if (stage && cardAdmin) {
    cardAdmin.addEventListener("mouseenter", () => stage.classList.add("hover-admin"));
    cardAdmin.addEventListener("mouseleave", () => stage.classList.remove("hover-admin"));
}

if (stage && cardUser) {
    cardUser.addEventListener("mouseenter", () => stage.classList.add("hover-user"));
    cardUser.addEventListener("mouseleave", () => stage.classList.remove("hover-user"));
}
