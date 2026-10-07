(function () {
  "use strict";

  var form = document.getElementById("search-form");
  var input = document.getElementById("question");
  var clearButton = document.getElementById("clear-input");
  var submitButton = document.getElementById("submit-btn");
  var answerBody = document.getElementById("answer-body");
  var appliedFilters = document.getElementById("applied-filters");

  var filterStatus = document.getElementById("filter-status");
  var filterLocale = document.getElementById("filter-locale");
  var filterCategory = document.getElementById("filter-category");
  var filterAsof = document.getElementById("filter-asof");

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

  function collectFilters() {
    var filters = {};
    if (filterStatus.value) filters.status = filterStatus.value;
    if (filterLocale.value) filters.locale = filterLocale.value;
    if (filterCategory.value) filters.category = filterCategory.value;
    if (filterAsof.value) filters.asOf = filterAsof.value;
    return filters;
  }

  function describeFilters(filters) {
    var keys = Object.keys(filters || {});
    if (keys.length === 0) return "none";
    return keys
      .map(function (key) {
        return key + "=" + filters[key];
      })
      .join("  \u00b7  ");
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
    appliedFilters.replaceChildren();
  }

  function renderAppliedFilters(filters) {
    appliedFilters.replaceChildren();
    appliedFilters.appendChild(element("span", "applied-label", "Filters:"));
    appliedFilters.appendChild(element("span", "applied-values", describeFilters(filters)));
  }

  function renderState(message, className) {
    clearAnswer();
    answerBody.appendChild(element("p", className || "state", message));
  }

  function renderResults(data) {
    answerBody.replaceChildren();
    renderAppliedFilters(data.filters);

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
      body: JSON.stringify({ query: question, filters: collectFilters() }),
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
      if (item.filters) {
        head.appendChild(element("span", "eval-filters", describeFilters(item.filters)));
      }
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

  function metricGroup(label, cards) {
    var group = document.createElement("div");
    group.className = "metric-group";
    group.appendChild(element("div", "metric-group-label", label));
    var row = document.createElement("div");
    row.className = "metrics";
    cards.forEach(function (card) {
      row.appendChild(card);
    });
    group.appendChild(row);
    return group;
  }

  function rankText(rank) {
    return rank === null ? "MISS" : "#" + rank;
  }

  function chunkText(outcome) {
    if (outcome.expectedChunk === undefined) return "\u2013";
    return outcome.chunkRank === null ? "MISS" : "#" + outcome.chunkRank;
  }

  function renderEvalReport(report) {
    evalResultsBody.replaceChildren();

    ["dense", "metadata"].forEach(function (modeKey) {
      var mode = report[modeKey];
      var metrics = mode.metrics;
      var label = modeKey === "dense" ? "Dense (no filters)" : "Dense + metadata";

      var docCards = [];
      if (report.topK >= 1) docCards.push(metricCard("Hit@1", percent(metrics.hitAt1)));
      if (report.topK >= 3) docCards.push(metricCard("Hit@3", percent(metrics.hitAt3)));
      if (report.topK >= 5) docCards.push(metricCard("Hit@5", percent(metrics.hitAt5)));
      docCards.push(metricCard("MRR@" + report.topK, metrics.mrr.toFixed(3)));
      docCards.push(metricCard("Found", metrics.found + "/" + metrics.queries));
      evalResultsBody.appendChild(metricGroup(label + " \u2014 document", docCards));

      if (metrics.chunkQueries > 0) {
        var chunkCards = [];
        if (report.topK >= 1) chunkCards.push(metricCard("Hit@1", percent(metrics.chunkHitAt1)));
        if (report.topK >= 3) chunkCards.push(metricCard("Hit@3", percent(metrics.chunkHitAt3)));
        if (report.topK >= 5) chunkCards.push(metricCard("Hit@5", percent(metrics.chunkHitAt5)));
        chunkCards.push(metricCard("MRR@" + report.topK, metrics.chunkMrr.toFixed(3)));
        chunkCards.push(metricCard("Found", metrics.chunkFound + "/" + metrics.chunkQueries));
        evalResultsBody.appendChild(metricGroup(label + " \u2014 chunk", chunkCards));
      }
    });

    evalResultsBody.appendChild(
      element("p", "eval-meta", report.provider + " / " + report.model + " \u00b7 k=" + report.topK),
    );

    var scroll = document.createElement("div");
    scroll.className = "table-scroll";

    var table = document.createElement("table");
    table.className = "eval-table";
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["id", "query", "dense doc", "dense chunk", "meta doc", "meta chunk", "expected"].forEach(function (label) {
      headRow.appendChild(element("th", null, label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    report.dense.outcomes.forEach(function (denseOutcome, index) {
      var metaOutcome = report.metadata.outcomes[index];
      if (!metaOutcome) return;

      var row = document.createElement("tr");
      if (metaOutcome.rank === null) row.className = "is-miss";

      row.appendChild(element("td", "cell-id", denseOutcome.id));
      row.appendChild(element("td", "cell-query", denseOutcome.query));

      row.appendChild(element("td", "cell-rank", rankText(denseOutcome.rank)));

      var denseChunk = element("td", "cell-chunk", chunkText(denseOutcome));
      if (denseOutcome.expectedChunk !== undefined && denseOutcome.chunkRank === null) {
        denseChunk.classList.add("is-miss");
      }
      row.appendChild(denseChunk);

      row.appendChild(element("td", "cell-rank", rankText(metaOutcome.rank)));

      var metaChunk = element("td", "cell-chunk", chunkText(metaOutcome));
      if (metaOutcome.expectedChunk !== undefined && metaOutcome.chunkRank === null) {
        metaChunk.classList.add("is-miss");
      }
      row.appendChild(metaChunk);

      var expectedText = denseOutcome.expected.join(", ");
      if (denseOutcome.expectedChunk !== undefined) expectedText += " \u00b7 chunk " + denseOutcome.expectedChunk;
      row.appendChild(element("td", "cell-expected", expectedText));

      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    evalResultsBody.appendChild(scroll);
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
