const paidBetaForm = document.querySelector("#paidBetaForm");
const paidBetaStatus = document.querySelector("#paidBetaStatus");

paidBetaForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  paidBetaStatus.className = "form-status";
  paidBetaStatus.textContent = "Saving paid beta request...";

  const formData = new FormData(paidBetaForm);
  const payload = {
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    channel: formData.get("channel") || "email",
    frequency: formData.get("frequency") || "daily",
    digestFormat: formData.get("digestFormat") || "html",
    interests: formData.getAll("interests"),
    plan: "paid-beta",
    subscribed: true,
  };

  try {
    const response = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save paid beta request.");
    paidBetaStatus.textContent = "Paid beta request saved. We will activate access after review.";
    paidBetaStatus.classList.add("success");
    paidBetaForm.reset();
  } catch (error) {
    paidBetaStatus.textContent = error.message;
    paidBetaStatus.classList.add("error");
  }
});
