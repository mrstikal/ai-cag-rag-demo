(function () {
  "use strict";

  var NO_ANSWER_TEXT =
    "We're sorry, but we couldn't find anything for your question. Please contact customer support.";

  function answerText(data) {
    if (data.status === "answered" && typeof data.answer === "string" && data.answer.trim() !== "") {
      return data.answer;
    }
    return NO_ANSWER_TEXT;
  }

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
      item.appendChild(renderTextBlock(stripLeadingHeading(hit.text)));

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

  // ====================== Tab: answer =====================================
  var answerForm = document.getElementById("answer-form");
  var answerInput = document.getElementById("answer-question");
  var answerClearBtn = document.getElementById("answer-clear");
  var answerSubmitBtn = document.getElementById("answer-submit");
  var answerMetaEl = document.getElementById("answer-meta");
  var answerBodyEl = document.getElementById("answer-tab-body");
  var answerSourcesEl = document.getElementById("answer-sources");
  var answerSourcesTitle = document.getElementById("answer-sources-title");

  function clearAnswerTab() {
    answerBodyEl.replaceChildren();
    answerSourcesEl.replaceChildren();
    answerMetaEl.replaceChildren();
    answerSourcesTitle.hidden = true;
  }

  function citationBadge(sourceId) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "cite";
    button.dataset.source = sourceId;
    button.textContent = sourceId;
    return button;
  }

  function richTextNodes(text, allowCitations) {
    var fragment = document.createDocumentFragment();
    text.split(/(\*\*[^*]+\*\*|\[[SD]\d+\])/g).forEach(function (part) {
      if (!part) return;
      var bold = /^\*\*([^*]+)\*\*$/.exec(part);
      if (bold && bold[1]) {
        fragment.appendChild(element("strong", null, bold[1]));
        return;
      }
      var cite = /^\[([SD]\d+)\]$/.exec(part);
      if (cite && cite[1] && allowCitations) {
        fragment.appendChild(citationBadge(cite[1]));
        return;
      }
      fragment.appendChild(document.createTextNode(part));
    });
    return fragment;
  }

  function renderAnswerText(text) {
    var container = document.createElement("div");
    container.className = "answer-text";
    container.appendChild(richTextNodes(text, true));
    return container;
  }

  function renderTextBlock(text) {
    var block = document.createElement("p");
    block.className = "text";
    block.appendChild(richTextNodes(text, false));
    return block;
  }

  function renderAnswer(data) {
    clearAnswerTab();

    answerMetaEl.appendChild(element("span", "applied-label", "status:"));
    var statusBadge = element("span", "status-badge is-" + data.status, data.status);
    answerMetaEl.appendChild(statusBadge);
    answerMetaEl.appendChild(element("span", "applied-label", "model:"));
    answerMetaEl.appendChild(element("span", "applied-values", data.model));

    answerBodyEl.appendChild(renderAnswerText(answerText(data)));

    if (data.sources && data.sources.length > 0) {
      answerSourcesTitle.hidden = false;
      var list = document.createElement("ol");
      list.className = "source-list";
      data.sources.forEach(function (source) {
        var li = document.createElement("li");
        li.className = "source-card";
        li.id = "source-" + source.sourceId;

        var head = document.createElement("div");
        head.className = "source-head";
        head.appendChild(element("span", "cite-static", source.sourceId.replace(/^S/, "")));
        head.appendChild(element("span", "source-title", source.title));
        var badge = element("span", "badge", source.status);
        if (source.status !== "active") badge.classList.add("is-obsolete");
        head.appendChild(badge);
        li.appendChild(head);

        li.appendChild(element("div", "result-meta", source.citation));
        if (source.rerankScore !== undefined && source.rerankScore !== null) {
          li.appendChild(element("div", "source-score", "rerank " + Number(source.rerankScore).toFixed(4)));
        }
        li.appendChild(renderTextBlock(stripLeadingHeading(source.text)));
        list.appendChild(li);
      });
      answerSourcesEl.appendChild(list);
    }
  }

  answerInput.addEventListener("input", function () {
    answerClearBtn.hidden = answerInput.value.length === 0;
    if (answerInput.value.trim() === "") clearAnswerTab();
  });

  answerClearBtn.addEventListener("click", function () {
    answerInput.value = "";
    answerClearBtn.hidden = true;
    clearAnswerTab();
    answerInput.focus();
  });

  answerForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var question = answerInput.value.trim();
    if (question === "") {
      clearAnswerTab();
      return;
    }
    answerSubmitBtn.disabled = true;
    clearAnswerTab();
    answerBodyEl.appendChild(element("p", "state", "Generating\u2026"));

    fetch("/api/answer", {
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
        renderAnswer(data);
      })
      .catch(function (error) {
        clearAnswerTab();
        answerBodyEl.appendChild(element("p", "error", error.message || "Answer failed"));
      })
      .then(function () {
        answerSubmitBtn.disabled = false;
      });
  });

  answerBodyEl.addEventListener("click", function (event) {
    var target = event.target;
    if (target && target.classList && target.classList.contains("cite")) {
      var card = document.getElementById("source-" + target.dataset.source);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("is-highlight");
        setTimeout(function () {
          card.classList.remove("is-highlight");
        }, 1200);
      }
    }
  });

  // ====================== Tab: agentic ====================================
  var agenticForm = document.getElementById("agentic-form");
  var agenticInput = document.getElementById("agentic-question");
  var agenticClearBtn = document.getElementById("agentic-clear");
  var agenticSubmitBtn = document.getElementById("agentic-submit");
  var agenticMetaEl = document.getElementById("agentic-meta");
  var agenticBodyEl = document.getElementById("agentic-body");
  var agenticTraceEl = document.getElementById("agentic-trace");
  var agenticSourcesEl = document.getElementById("agentic-sources");
  var agenticSourcesTitle = document.getElementById("agentic-sources-title");

  function clearAgentic() {
    agenticBodyEl.replaceChildren();
    agenticTraceEl.replaceChildren();
    agenticSourcesEl.replaceChildren();
    agenticMetaEl.replaceChildren();
    agenticSourcesTitle.hidden = true;
  }

  function renderAgenticTrace(data) {
    var wrap = document.createElement("div");
    wrap.className = "trace";
    wrap.appendChild(element("div", "trace-title", "Retrieval trace"));
    wrap.appendChild(element("div", "trace-step", "initial retrieval \u2192 " + data.initialChunks + " chunks"));
    data.searches.forEach(function (step, index) {
      var line =
        "search_kb #" +
        (index + 1) +
        '  "' +
        step.query +
        '"' +
        (step.category ? "  category=" + step.category : "") +
        "  \u2192 +" +
        step.added +
        " chunks";
      wrap.appendChild(element("div", "trace-step", line));
    });
    if (data.searches.length === 0) {
      wrap.appendChild(element("div", "trace-note", "no extra searches needed"));
    }
    wrap.appendChild(
      element("div", "trace-note", "unique chunks: " + data.uniqueChunks + " (max extra searches: " + data.maxExtraSearches + ")"),
    );
    agenticTraceEl.appendChild(wrap);
  }

  function renderAgentic(data) {
    clearAgentic();

    agenticMetaEl.appendChild(element("span", "applied-label", "status:"));
    agenticMetaEl.appendChild(element("span", "status-badge is-" + data.status, data.status));
    agenticMetaEl.appendChild(element("span", "applied-label", "model:"));
    agenticMetaEl.appendChild(element("span", "applied-values", data.model));

    agenticBodyEl.appendChild(renderAnswerText(answerText(data)));
    renderAgenticTrace(data);

    if (data.sources && data.sources.length > 0) {
      agenticSourcesTitle.hidden = false;
      var list = document.createElement("ol");
      list.className = "source-list";
      data.sources.forEach(function (source) {
        var li = document.createElement("li");
        li.className = "source-card";
        li.id = "agentic-source-" + source.sourceId;

        var head = document.createElement("div");
        head.className = "source-head";
        head.appendChild(element("span", "cite-static", source.sourceId.replace(/^S/, "")));
        head.appendChild(element("span", "source-title", source.title));
        var badge = element("span", "badge", source.status);
        if (source.status !== "active") badge.classList.add("is-obsolete");
        head.appendChild(badge);
        li.appendChild(head);

        li.appendChild(element("div", "result-meta", source.citation));
        if (source.rerankScore !== null && source.rerankScore !== undefined) {
          li.appendChild(element("div", "source-score", "rerank " + Number(source.rerankScore).toFixed(4)));
        }
        li.appendChild(renderTextBlock(stripLeadingHeading(source.text)));
        list.appendChild(li);
      });
      agenticSourcesEl.appendChild(list);
    }
  }

  agenticInput.addEventListener("input", function () {
    agenticClearBtn.hidden = agenticInput.value.length === 0;
    if (agenticInput.value.trim() === "") clearAgentic();
  });

  agenticClearBtn.addEventListener("click", function () {
    agenticInput.value = "";
    agenticClearBtn.hidden = true;
    clearAgentic();
    agenticInput.focus();
  });

  agenticForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var question = agenticInput.value.trim();
    if (question === "") {
      clearAgentic();
      return;
    }
    agenticSubmitBtn.disabled = true;
    clearAgentic();
    agenticBodyEl.appendChild(element("p", "state", "Running agentic answer\u2026"));

    fetch("/api/agentic", {
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
        renderAgentic(data);
      })
      .catch(function (error) {
        clearAgentic();
        agenticBodyEl.appendChild(element("p", "error", error.message || "Agentic answer failed"));
      })
      .then(function () {
        agenticSubmitBtn.disabled = false;
      });
  });

  agenticBodyEl.addEventListener("click", function (event) {
    var target = event.target;
    if (target && target.classList && target.classList.contains("cite")) {
      var card = document.getElementById("agentic-source-" + target.dataset.source);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("is-highlight");
        setTimeout(function () {
          card.classList.remove("is-highlight");
        }, 1200);
      }
    }
  });

  // ====================== Tab: CAG ========================================
  var cagForm = document.getElementById("cag-form");
  var cagInput = document.getElementById("cag-question");
  var cagClearBtn = document.getElementById("cag-clear");
  var cagSubmitBtn = document.getElementById("cag-submit");
  var cagMetaEl = document.getElementById("cag-meta");
  var cagBodyEl = document.getElementById("cag-body");
  var cagSourcesEl = document.getElementById("cag-sources");
  var cagSourcesTitle = document.getElementById("cag-sources-title");

  function clearCag() {
    cagBodyEl.replaceChildren();
    cagSourcesEl.replaceChildren();
    cagMetaEl.replaceChildren();
    cagSourcesTitle.hidden = true;
  }

  function metaItem(container, label, value) {
    container.appendChild(element("span", "applied-label", label));
    container.appendChild(element("span", "applied-values", value));
  }

  function renderCag(data) {
    clearCag();
    metaItem(cagMetaEl, "status:", data.status);
    metaItem(cagMetaEl, "model:", data.model);
    metaItem(cagMetaEl, "context:", data.contextDocuments + " docs / ~" + data.contextTokens + " tok");
    if (data.usage) {
      metaItem(cagMetaEl, "tokens:", data.usage.inputTokens + " in / " + data.usage.cachedTokens + " cached / " + data.usage.outputTokens + " out");
    }
    if (data.timings) {
      metaItem(cagMetaEl, "llm:", data.timings.generationMs + " ms");
    }

    cagBodyEl.appendChild(renderAnswerText(answerText(data)));

    if (data.sources && data.sources.length > 0) {
      cagSourcesTitle.hidden = false;
      var list = document.createElement("ol");
      list.className = "source-list";
      data.sources.forEach(function (source) {
        var li = document.createElement("li");
        li.className = "source-card";
        li.id = "cag-source-" + source.sourceId;
        var head = document.createElement("div");
        head.className = "source-head";
        head.appendChild(element("span", "cite-static", source.sourceId));
        head.appendChild(element("span", "source-title", source.title));
        var badge = element("span", "badge", source.status);
        if (source.status !== "active") badge.classList.add("is-obsolete");
        head.appendChild(badge);
        li.appendChild(head);
        li.appendChild(element("div", "result-meta", source.documentId + " \u00b7 v" + source.version));
        li.appendChild(renderTextBlock(stripLeadingHeading(source.text)));
        list.appendChild(li);
      });
      cagSourcesEl.appendChild(list);
    }
  }

  cagInput.addEventListener("input", function () {
    cagClearBtn.hidden = cagInput.value.length === 0;
    if (cagInput.value.trim() === "") clearCag();
  });
  cagClearBtn.addEventListener("click", function () {
    cagInput.value = "";
    cagClearBtn.hidden = true;
    clearCag();
    cagInput.focus();
  });
  cagForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var question = cagInput.value.trim();
    if (question === "") {
      clearCag();
      return;
    }
    cagSubmitBtn.disabled = true;
    clearCag();
    cagBodyEl.appendChild(element("p", "state", "Generating from the full knowledge base\u2026"));
    fetch("/api/cag", {
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
        renderCag(data);
      })
      .catch(function (error) {
        clearCag();
        cagBodyEl.appendChild(element("p", "error", error.message || "CAG answer failed"));
      })
      .then(function () {
        cagSubmitBtn.disabled = false;
      });
  });
  cagBodyEl.addEventListener("click", function (event) {
    var target = event.target;
    if (target && target.classList && target.classList.contains("cite")) {
      var card = document.getElementById("cag-source-" + target.dataset.source);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("is-highlight");
        setTimeout(function () {
          card.classList.remove("is-highlight");
        }, 1200);
      }
    }
  });

  // ====================== Tab: compare ====================================
  var compareForm = document.getElementById("compare-form");
  var compareInput = document.getElementById("compare-question");
  var compareClearBtn = document.getElementById("compare-clear");
  var compareSubmitBtn = document.getElementById("compare-submit");
  var compareBodyEl = document.getElementById("compare-body");

  function renderCompare(data) {
    compareBodyEl.replaceChildren();
    var grid = document.createElement("div");
    grid.className = "compare-grid";

    [
      ["RAG", data.rag],
      ["CAG", data.cag],
    ].forEach(function (pair) {
      var name = pair[0];
      var value = pair[1];
      var col = document.createElement("div");
      col.className = "compare-col";
      col.appendChild(element("div", "compare-head", name));

      var metrics = document.createElement("ul");
      metrics.className = "compare-metrics";
      function row(label, text) {
        var li = document.createElement("li");
        li.appendChild(element("span", "cm-label", label));
        li.appendChild(element("span", "cm-value", String(text)));
        metrics.appendChild(li);
      }
      row("status", value.status);
      row("retrieval", (value.timings ? value.timings.retrievalMs : 0) + " ms");
      row("LLM", (value.timings ? value.timings.generationMs : 0) + " ms");
      row("total", (value.timings ? value.timings.totalMs : 0) + " ms");
      row("input tokens", value.usage ? value.usage.inputTokens : 0);
      row("cached tokens", value.usage ? value.usage.cachedTokens : 0);
      if (value.contextTokens) row("context tokens", value.contextTokens);
      row(name === "RAG" ? "sources (chunks)" : "sources (docs)", value.sourceCount);
      col.appendChild(metrics);

      col.appendChild(element("div", "compare-label", "answer"));
      var answer = document.createElement("div");
      answer.className = "answer-text";
      answer.appendChild(richTextNodes(answerText(value), true));
      col.appendChild(answer);

      col.appendChild(element("div", "compare-label", "citations"));
      col.appendChild(element("div", "compare-citations", (value.citations || []).join(" ") || "\u2013"));

      grid.appendChild(col);
    });

    compareBodyEl.appendChild(grid);
  }

  compareInput.addEventListener("input", function () {
    compareClearBtn.hidden = compareInput.value.length === 0;
    if (compareInput.value.trim() === "") compareBodyEl.replaceChildren();
  });
  compareClearBtn.addEventListener("click", function () {
    compareInput.value = "";
    compareClearBtn.hidden = true;
    compareBodyEl.replaceChildren();
    compareInput.focus();
  });
  compareForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var question = compareInput.value.trim();
    if (question === "") {
      compareBodyEl.replaceChildren();
      return;
    }
    compareSubmitBtn.disabled = true;
    compareBodyEl.replaceChildren();
    compareBodyEl.appendChild(element("p", "state", "Running RAG and CAG\u2026"));
    fetch("/api/compare", {
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
        renderCompare(data);
      })
      .catch(function (error) {
        compareBodyEl.replaceChildren();
        compareBodyEl.appendChild(element("p", "error", error.message || "Compare failed"));
      })
      .then(function () {
        compareSubmitBtn.disabled = false;
      });
  });

  // ====================== Generation eval =================================
  var genEvalRun = document.getElementById("gen-eval-run");
  var genEvalBody = document.getElementById("gen-eval-body");

  function renderGenEvalState(message, className) {
    genEvalBody.replaceChildren();
    genEvalBody.appendChild(element("p", className || "state", message));
  }

  function metricTile(label, value) {
    var tile = document.createElement("div");
    tile.className = "metric";
    tile.appendChild(element("span", "metric-value", value));
    tile.appendChild(element("span", "metric-label", label));
    return tile;
  }

  function renderGenEval(report) {
    genEvalBody.replaceChildren();
    var metrics = report.metrics;

    var cards = document.createElement("div");
    cards.className = "metrics";
    cards.appendChild(metricTile("Answerable", metrics.answerableCorrect + "/" + metrics.answerableTotal));
    cards.appendChild(metricTile("Unanswerable", metrics.unanswerableCorrect + "/" + metrics.unanswerableTotal));
    cards.appendChild(metricTile("Citations valid", metrics.citationValid + "/" + metrics.total));
    cards.appendChild(metricTile("Source hit", metrics.expectedSourceHit + "/" + metrics.answerableTotal));
    genEvalBody.appendChild(cards);
    genEvalBody.appendChild(element("p", "eval-meta", "model: " + report.model));

    var scroll = document.createElement("div");
    scroll.className = "table-scroll";
    var table = document.createElement("table");
    table.className = "eval-table";
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["id", "type", "status", "src", "facts", "citations", "question"].forEach(function (label) {
      headRow.appendChild(element("th", null, label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    report.outcomes.forEach(function (outcome) {
      var row = document.createElement("tr");
      if (outcome.status === "error" || (outcome.answerable && outcome.expectedSourceHit !== true)) {
        row.className = "is-miss";
      }
      row.appendChild(element("td", "cell-id", outcome.id));
      row.appendChild(element("td", null, outcome.answerable ? "ans" : "unans"));
      row.appendChild(element("td", null, outcome.status));
      row.appendChild(element("td", "cell-rank", outcome.answerable ? (outcome.expectedSourceHit ? "ok" : "MISS") : "\u2013"));
      row.appendChild(element("td", "cell-rank", outcome.answerable ? (outcome.factsOk ? "ok" : "MISS") : "\u2013"));
      row.appendChild(element("td", null, outcome.citations.join(" ") || "\u2013"));
      row.appendChild(element("td", "cell-query", outcome.question));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    genEvalBody.appendChild(scroll);
  }

  genEvalRun.addEventListener("click", function () {
    genEvalRun.disabled = true;
    renderGenEvalState("Running generation eval\u2026");
    fetch("/api/generation/eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
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
        renderGenEval(report);
      })
      .catch(function (error) {
        renderGenEvalState(error.message || "Generation eval failed", "error");
      })
      .then(function () {
        genEvalRun.disabled = false;
      });
  });

  // --- Init ---------------------------------------------------------------
  updateClearButton();
  loadEvalQueries();
})();
