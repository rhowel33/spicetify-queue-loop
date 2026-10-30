// NAME: Queue Loop
// AUTHOR: rhowel33
// DESCRIPTION: Adds a loop button to the queue panel so your queued songs repeat. Clearing the queue turns it off.
// VERSION: 1.0.0

(function queueLoop() {
	const PlayerAPI = Spicetify?.Platform?.PlayerAPI;
	if (!PlayerAPI?.getQueue || !Spicetify.addToQueue || !Spicetify.Locale || !document.body) {
		setTimeout(queueLoop, 300);
		return;
	}

	const events = PlayerAPI.getEvents?.() ?? PlayerAPI._events;
	// Spicetify.addToQueue talks to the queue directly, which skips Spotify's "Added to queue"
	// toast on every loop. It needs PlayerAPI internals, so fall back to the public call.
	const addToQueue = Spicetify.Player?.origin?._queue ? Spicetify.addToQueue : (items) => PlayerAPI.addToQueue(items);
	const CLEAR_LABEL = String(Spicetify.Locale.get("queue.clear-queue") || "Clear queue");
	const BUTTON_CLASS = "queue-loop-button";
	const MAX_REMEMBERED = 200;

	let enabled = false;
	let currentKey = null;
	// Queue items that have already been sent back to the end of the queue, so skipping
	// back onto one (or Spotify replaying it from history) doesn't add it twice.
	const requeued = new Set();
	// URIs re-added but not yet seen in the queue. While the last queued song plays the
	// queue is briefly empty; that isn't the user clearing it.
	const inFlight = new Set();

	// Every queue entry gets its own uid, so the same song queued twice is two entries.
	const keyOf = (item) => item.uid || item.uri;

	function remember(item) {
		requeued.add(keyOf(item));
		if (requeued.size > MAX_REMEMBERED) requeued.delete(requeued.values().next().value);
	}

	async function requeue(item) {
		remember(item);
		inFlight.add(item.uri);
		setTimeout(() => inFlight.delete(item.uri), 5000);
		try {
			await addToQueue([{ uri: item.uri }]);
		} catch (err) {
			inFlight.delete(item.uri);
			console.error("[queue-loop] Couldn't re-queue", item.uri, err);
		}
	}

	function enable() {
		const { current, queued } = PlayerAPI.getQueue();
		if (!queued.length) {
			Spicetify.showNotification("Add some songs to your queue first");
			return;
		}
		enabled = true;
		requeued.clear();
		currentKey = current ? keyOf(current) : null;
		// The song playing now is part of the loop too, so it comes back around after the rest.
		if (current) requeue(current);
		render();
		const count = queued.length + (current ? 1 : 0);
		Spicetify.showNotification(`Looping ${count} song${count === 1 ? "" : "s"}`);
	}

	function disable(message) {
		if (!enabled) return;
		enabled = false;
		requeued.clear();
		inFlight.clear();
		render();
		if (message) Spicetify.showNotification(message);
	}

	events.addListener("queue_action", ({ data }) => {
		if (data?.action === "clear") disable("Queue cleared, loop is off");
	});

	events.addListener("queue_update", ({ data }) => {
		if (!enabled || !data) return;
		const { current, queued } = data;
		for (const { uri } of queued) inFlight.delete(uri);

		if (current && keyOf(current) !== currentKey) {
			currentKey = keyOf(current);
			// Only songs that came from the queue loop; a playlist or album playing
			// underneath stays untouched.
			if (current.provider === "queue" && !requeued.has(currentKey)) {
				requeue(current);
				return;
			}
		}

		// Covers every way the queue can end up empty: removing songs one by one,
		// clearing from another device, etc.
		if (!queued.length && !inFlight.size) disable("Queue is empty, loop is off");
	});

	// UI: a toggle next to "Clear queue" in the queue panel's "Next in queue" header.

	const style = document.createElement("style");
	style.textContent = `
		.${BUTTON_CLASS} {
			position: relative;
			display: inline-flex;
			flex-shrink: 0;
			align-items: center;
			justify-content: center;
			width: 32px;
			height: 32px;
			margin-left: auto;
			margin-right: 4px;
			padding: 0;
			border: 0;
			border-radius: 50%;
			background: transparent;
			color: var(--spice-subtext, #b3b3b3);
			cursor: pointer;
		}
		.${BUTTON_CLASS}:hover {
			color: var(--spice-text, #fff);
			transform: scale(1.04);
		}
		.${BUTTON_CLASS}[aria-pressed="true"] {
			color: var(--spice-button-active, #1ed760);
		}
		.${BUTTON_CLASS}[aria-pressed="true"]::after {
			content: "";
			position: absolute;
			bottom: 2px;
			left: 50%;
			width: 4px;
			height: 4px;
			border-radius: 50%;
			background: currentColor;
			transform: translateX(-50%);
		}
		.${BUTTON_CLASS}:focus-visible {
			outline: 2px solid var(--spice-text, #fff);
			outline-offset: 1px;
		}
	`;
	document.head.appendChild(style);

	const label = () => (enabled ? "Stop looping queue" : "Loop queue");

	function createButton() {
		const button = document.createElement("button");
		button.type = "button";
		button.className = BUTTON_CLASS;
		button.innerHTML = `<svg role="img" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${Spicetify.SVGIcons.repeat}</svg>`;
		button.addEventListener("click", () => (enabled ? disable("Queue loop is off") : enable()));
		if (Spicetify.Tippy) button._tippy = Spicetify.Tippy(button, { ...Spicetify.TippyProps, content: label() });
		updateButton(button);
		return button;
	}

	function updateButton(button) {
		button.setAttribute("aria-pressed", String(enabled));
		button.setAttribute("aria-label", label());
		if (button._tippy) button._tippy.setContent(label());
		else button.title = label();
	}

	function render() {
		for (const button of document.querySelectorAll(`.${BUTTON_CLASS}`)) updateButton(button);
	}

	const isClearButton = (el) => el?.tagName === "BUTTON" && el.textContent.trim() === CLEAR_LABEL;

	function mountButtons() {
		// Spotify re-renders the header freely; drop any of ours that lost their neighbour.
		for (const button of document.querySelectorAll(`.${BUTTON_CLASS}`)) {
			if (!isClearButton(button.nextElementSibling)) {
				button._tippy?.destroy();
				button.remove();
			}
		}
		for (const clear of document.querySelectorAll("button")) {
			// The h2 check keeps us out of the "Clear queue?" confirmation dialog.
			if (!isClearButton(clear) || !clear.parentElement?.querySelector("h2")) continue;
			if (clear.previousElementSibling?.classList.contains(BUTTON_CLASS)) continue;
			clear.before(createButton());
		}
	}

	let scheduled = false;
	new MutationObserver(() => {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;
			mountButtons();
		});
	}).observe(document.body, { childList: true, subtree: true });
	mountButtons();
})();
