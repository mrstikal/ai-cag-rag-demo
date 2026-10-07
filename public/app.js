(function () {
  "use strict";

  var form = document.getElementById("search-form");
  var input = document.getElementById("question");
  var clearButton = document.getElementById("clear-input");
  var submitButton = document.getElementById("submit-btn");
  var answerBody = document.getElementById("answer-body");
  var appliedFilters = document.getElementById("applied-filters");

  var filterRetriever = document.getElementById("filter-retriever");
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

  function renderAppliedFilters(retriever, filters) {
    appliedFilters.replaceChildren();
    appliedFilters.appendChild(element("span", "applied-label", "Retriever:"));
    appliedFilters.appendChild(element("span", "applied-values", retriever));
    appliedFilters.appendChild(element("span", "applied-label", "Filters:"));
    appliedFilters.appendChild(element("span", "applied-values", describeFilters(filters)));
  }

  function renderState(message, className) {
    clearAnswer();
    answerBody.appendChild(element("p", className || "state", message));
  }

  function renderResults(data) {
    answerBody.replaceChildren();
    renderAppliedFilters(data.retriever, data.filters);

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
      body: JSON.stringify({ query: question, retriever: filterRetriever.value, filters: collectFilters() }),
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

  var MODE_COLUMNS = [
    { key: "dense", label: "Dense" },
    { key: "denseMetadata", label: "Dense+meta" },
    { key: "bm25", label: "BM25" },
    { key: "bm25Metadata", label: "BM25+meta" },
    { key: "hybrid", label: "Hybrid" },
    { key: "hybridMetadata", label: "Hybrid+meta" },
    { key: "rerank", label: "Rerank" },
    { key: "rerankMetadata", label: "Rerank+meta" },
  ];

  function buildMetricsTable(report) {
    var table = document.createElement("table");
    table.className = "eval-table";

    var headRow = document.createElement("tr");
    ["Retriever", "Doc H@1", "Doc H@3", "Doc H@5", "Doc MRR", "Chunk H@1", "Chunk H@3", "Chunk H@5", "Chunk MRR"].forEach(
      function (label) {
        headRow.appendChild(element("th", null, label));
      },
    );
    var thead = document.createElement("thead");
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    MODE_COLUMNS.forEach(function (column) {
      var metrics = report.modes[column.key].metrics;
      var row = document.createElement("tr");
      row.appendChild(element("td", "cell-retriever", column.label));
      [metrics.hitAt1, metrics.hitAt3, metrics.hitAt5].forEach(function (value) {
        row.appendChild(element("td", "cell-num", percent(value)));
      });
      row.appendChild(element("td", "cell-num", metrics.mrr.toFixed(3)));
      [metrics.chunkHitAt1, metrics.chunkHitAt3, metrics.chunkHitAt5].forEach(function (value) {
        row.appendChild(element("td", "cell-num", percent(value)));
      });
      row.appendChild(element("td", "cell-num", metrics.chunkMrr.toFixed(3)));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    return table;
  }

  function buildRecallTable(report) {
    var table = document.createElement("table");
    table.className = "eval-table";

    var headRow = document.createElement("tr");
    ["Retriever", "Doc R@10", "Doc R@20", "Chunk R@10", "Chunk R@20"].forEach(function (label) {
      headRow.appendChild(element("th", null, label));
    });
    var thead = document.createElement("thead");
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    MODE_COLUMNS.forEach(function (column) {
      var metrics = report.modes[column.key].metrics;
      var row = document.createElement("tr");
      row.appendChild(element("td", "cell-retriever", column.label));
      [metrics.recallAt10, metrics.recallAt20, metrics.chunkRecallAt10, metrics.chunkRecallAt20].forEach(
        function (value) {
          row.appendChild(element("td", "cell-num", percent(value)));
        },
      );
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    return table;
  }

  function buildRankTable(report, kind) {
    var table = document.createElement("table");
    table.className = "eval-table";

    var headRow = document.createElement("tr");
    headRow.appendChild(element("th", null, "id"));
    headRow.appendChild(element("th", null, "query"));
    MODE_COLUMNS.forEach(function (column) {
      headRow.appendChild(element("th", null, column.label));
    });
    headRow.appendChild(element("th", null, "expected"));
    var thead = document.createElement("thead");
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    report.modes.dense.outcomes.forEach(function (baseOutcome, index) {
      var row = document.createElement("tr");
      row.appendChild(element("td", "cell-id", baseOutcome.id));
      row.appendChild(element("td", "cell-query", baseOutcome.query));

      MODE_COLUMNS.forEach(function (column) {
        var outcome = report.modes[column.key].outcomes[index];
        var cell = document.createElement("td");
        if (kind === "chunk") {
          cell.className = "cell-chunk";
          if (!outcome || outcome.expectedChunk === undefined) {
            cell.textContent = "\u2013";
          } else if (outcome.chunkRank === null) {
            cell.textContent = "MISS";
            cell.classList.add("is-miss");
          } else {
            cell.textContent = "#" + outcome.chunkRank;
          }
        } else {
          cell.className = "cell-rank";
          if (!outcome || outcome.rank === null) {
            cell.textContent = "MISS";
            cell.classList.add("is-miss");
          } else {
            cell.textContent = "#" + outcome.rank;
          }
        }
        row.appendChild(cell);
      });

      var expectedText = baseOutcome.expected.join(", ");
      if (baseOutcome.expectedChunk !== undefined) expectedText += " \u00b7 chunk " + baseOutcome.expectedChunk;
      row.appendChild(element("td", "cell-expected", expectedText));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    return table;
  }

  function tableView(title, table) {
    var wrap = document.createElement("div");
    wrap.appendChild(element("h3", "section-title", title));
    var scroll = document.createElement("div");
    scroll.className = "table-scroll";
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    return wrap;
  }

  function renderEvalReport(report) {
    evalResultsBody.replaceChildren();
    evalResultsBody.appendChild(
      element(
        "p",
        "eval-meta",
        report.provider +
          " / " +
          report.model +
          " \u00b7 k=" +
          report.topK +
          " \u00b7 candidates=" +
          report.candidateDepth +
          " \u00b7 reranker: " +
          report.reranker.provider +
          " / " +
          report.reranker.model,
      ),
    );
    evalResultsBody.appendChild(tableView("Metrics", buildMetricsTable(report)));
    evalResultsBody.appendChild(tableView("Candidate recall", buildRecallTable(report)));
    evalResultsBody.appendChild(tableView("Document rank", buildRankTable(report, "doc")));
    evalResultsBody.appendChild(tableView("Chunk rank", buildRankTable(report, "chunk")));
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
