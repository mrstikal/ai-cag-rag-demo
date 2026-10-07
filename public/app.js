(function () {
  "use strict";

  var form = document.getElementById("search-form");
  var input = document.getElementById("question");
  var clearButton = document.getElementById("clear-input");
  var submitButton = document.getElementById("submit-btn");
  var answerBody = document.getElementById("answer-body");

  var evalRun = document.getElementById("eval-run");
  var evalTopK = document.getElementById("eval-topk");
  var evalQueries = document.getElementById("eval-queries");
  var evalResultsBody = document.getElementById("eval-results-body");

  // --- Shared helpers -----------------------------------------------------
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function percent(value) {
    return Math.round(value * 100) + "%";
  }

  function stripLeadingHeading(text) {
    var stripped = text.replace(/^#{1,6}\s+.*\n?/, "").trim();
    return stripped !== "" ? stripped : text.trim();
  }

  // --- Tabs ---------------------------------------------------------------
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  var panels = Array.prototype.slice.call(document.querySelectorAll(".panel"));

  function activateTab(name) {
    tabs.forEach(function (tab) {
      var active = tab.dataset.tab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    panels.forEach(function (panel) {
      var active = panel.id === "panel-" + name;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      activateTab(tab.dataset.tab);
    });
  });

  // ====================== Tab 1: search ===================================
  function clearAnswer() {
    answerBody.replaceChildren();
  }

  function renderState(message, className) {
    clearAnswer();
    answerBody.appendChild(element("p", className || "state", message));
  }

  function renderResults(data) {
    clearAnswer();

    if (!data.results || data.results.length === 0) {
      answerBody.appendChild(element("p", "state", "No matching chunks found."));
      return;
    }

    var list = document.createElement("ol");
    list.className = "results";

    data.results.forEach(function (hit, index) {
      var item = document.createElement("li");
      item.className = "result";

      var head = document.createElement("div");
      head.className = "result-head";
      head.appendChild(element("span", "rank", "#" + (index + 1)));
      head.appendChild(element("span", "score", Number(hit.score).toFixed(4)));
      var badge = element("span", "badge", hit.status);
      if (hit.status !== "active") badge.classList.add("is-obsolete");
      head.appendChild(badge);
      item.appendChild(head);

      item.appendChild(element("div", "result-title", hit.title));
      item.appendChild(
        element("div", "result-meta", hit.documentId + " \u00b7 chunk " + hit.chunkIndex),
      );
      item.appendChild(element("p", "text", stripLeadingHeading(hit.text)));

      list.appendChild(item);
    });

    answerBody.appendChild(list);

    if (data.provider === "mock") {
      answerBody.appendChild(
        element(
          "p",
          "note",
          "Embeddings provider: mock (lexical only). Set EMBEDDINGS_PROVIDER=openai for semantic retrieval.",
        ),
      );
    }
  }

  function updateClearButton() {
    clearButton.hidden = input.value.length === 0;
  }

  input.addEventListener("input", function () {
    updateClearButton();
    if (input.value.trim() === "") clearAnswer();
  });

  clearButton.addEventListener("click", function () {
    input.value = "";
    updateClearButton();
    clearAnswer();
    input.focus();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var question = input.value.trim();
    if (question === "") {
      clearAnswer();
      input.focus();
      return;
    }

    submitButton.disabled = true;
    renderState("Searching\u2026");

    fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: question }),
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            if (!response.ok) throw new Error(data.error || "Request failed (" + response.status + ")");
            return data;
          });
      })
      .then(function (data) {
        if (input.value.trim() !== question) return;
        renderResults(data);
      })
      .catch(function (error) {
        renderState(error.message || "Search failed", "error");
      })
      .then(function () {
        submitButton.disabled = false;
      });
  });

  // ====================== Tab 2: eval =====================================
  function renderEvalQueries(queries) {
    evalQueries.replaceChildren();
    var list = document.createElement("ol");
    list.className = "eval-query-list";

    queries.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "eval-query";

      var head = document.createElement("div");
      head.className = "eval-query-head";
      head.appendChild(element("span", "eval-id", item.id));
      head.appendChild(element("span", "eval-expected", item.expected.join(" | ")));
      li.appendChild(head);

      li.appendChild(element("div", "eval-query-text", item.query));
      if (item.note) li.appendChild(element("div", "eval-query-note", item.note));

      list.appendChild(li);
    });

    evalQueries.appendChild(list);
  }

  function metricCard(label, value, hint) {
    var card = document.createElement("div");
    card.className = "metric";
    card.appendChild(element("span", "metric-value", value));
    card.appendChild(element("span", "metric-label", label));
    if (hint) card.appendChild(element("span", "metric-hint", hint));
    return card;
  }

  function renderEvalReport(report) {
    evalResultsBody.replaceChildren();

    var metrics = report.metrics;
    var cards = document.createElement("div");
    cards.className = "metrics";
    if (report.topK >= 1) cards.appendChild(metricCard("Hit@1", percent(metrics.hitAt1)));
    if (report.topK >= 3) cards.appendChild(metricCard("Hit@3", percent(metrics.hitAt3)));
    if (report.topK >= 5) cards.appendChild(metricCard("Hit@5", percent(metrics.hitAt5)));
    cards.appendChild(metricCard("MRR@" + report.topK, metrics.mrr.toFixed(3)));
    cards.appendChild(
      metricCard("Found", metrics.found + "/" + metrics.queries, "top-" + report.topK),
    );
    evalResultsBody.appendChild(cards);

    evalResultsBody.appendChild(
      element(
        "p",
        "eval-meta",
        report.provider + " / " + report.model + " \u00b7 k=" + report.topK,
      ),
    );

    var table = document.createElement("table");
    table.className = "eval-table";
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["id", "rank", "query", "expected", "top result"].forEach(function (label) {
      headRow.appendChild(element("th", null, label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    report.outcomes.forEach(function (outcome) {
      var row = document.createElement("tr");
      if (outcome.rank === null) row.className = "is-miss";

      row.appendChild(element("td", "cell-id", outcome.id));

      var rankCell = element("td", "cell-rank", outcome.rank === null ? "MISS" : "#" + outcome.rank);
      row.appendChild(rankCell);

      row.appendChild(element("td", "cell-query", outcome.query));
      row.appendChild(element("td", "cell-expected", outcome.expected.join(", ")));

      var top = outcome.results[0];
      var topText = top
        ? top.documentId + " \u00b7 chunk " + top.chunkIndex + " (" + top.score.toFixed(3) + ")"
        : "no results";
      row.appendChild(element("td", "cell-top", topText));

      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    evalResultsBody.appendChild(table);
  }

  function renderEvalState(message, className) {
    evalResultsBody.replaceChildren();
    evalResultsBody.appendChild(element("p", className || "state", message));
  }

  function loadEvalQueries() {
    fetch("/api/eval/queries")
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.error || "Request failed");
          return data;
        });
      })
      .then(function (data) {
        renderEvalQueries(data.queries);
      })
      .catch(function (error) {
        evalQueries.replaceChildren();
        evalQueries.appendChild(element("p", "error", error.message || "Failed to load queries"));
      });
  }

  evalRun.addEventListener("click", function () {
    var topK = parseInt(evalTopK.value, 10);
    if (!isFinite(topK) || topK <= 0) topK = 5;

    evalRun.disabled = true;
    renderEvalState("Running evaluation\u2026");

    fetch("/api/eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topK: topK }),
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            if (!response.ok) throw new Error(data.error || "Request failed (" + response.status + ")");
            return data;
          });
      })
      .then(function (report) {
        renderEvalReport(report);
      })
      .catch(function (error) {
        renderEvalState(error.message || "Evaluation failed", "error");
      })
      .then(function () {
        evalRun.disabled = false;
      });
  });

  // --- Init ---------------------------------------------------------------
  updateClearButton();
  loadEvalQueries();
})();
