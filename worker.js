export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/analyze") {
      return handleAnalyze(request);
    }

    return env.ASSETS.fetch(request);
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function cleanText(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function matchOne(html, regex) {
  const m = html.match(regex);
  return m ? cleanText(stripTags(m[1] || "")) : "";
}

function matchAll(html, regex) {
  const arr = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    arr.push(cleanText(stripTags(m[1] || "")));
  }
  return arr.filter(Boolean);
}

async function handleAnalyze(request) {
  try {
    const currentUrl = new URL(request.url);
    const targetUrl = (currentUrl.searchParams.get("url") || "").trim();

    if (!targetUrl.startsWith("http")) {
      return jsonResponse(
        { error: "请输入完整网址，例如：https://www.szbring.com/" },
        400
      );
    }

    const resp = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
      }
    });

    if (!resp.ok) {
      return jsonResponse(
        { error: `目标网页访问失败，状态码：${resp.status}` },
        500
      );
    }

    const html = await resp.text();

    const title = matchOne(html, /<title[^>]*>([\s\S]*?)<\/title>/i);

    const metaDesc =
      matchOne(
        html,
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i
      ) ||
      matchOne(
        html,
        /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i
      );

    const h1List = matchAll(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi);
    const h2List = matchAll(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi);

    const bodyText = cleanText(stripTags(html));
    const textLen = bodyText.length;

    const jsonldMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    const jsonldCount = jsonldMatches.length;
    let validJsonldCount = 0;
    const schemaTypes = [];

    for (const m of jsonldMatches) {
      try {
        const raw = cleanText(m[1] || "");
        const data = JSON.parse(raw);
        validJsonldCount += 1;

        if (Array.isArray(data)) {
          for (const item of data) {
            if (item && item["@type"]) schemaTypes.push(String(item["@type"]));
          }
        } else if (data && data["@type"]) {
          schemaTypes.push(String(data["@type"]));
        }
      } catch (e) {
        // ignore invalid JSON-LD
      }
    }

    const factRegex = /\d+(\.\d+)?\s*(%|％|年|个月|月|天|小时|分钟|万元|亿元|元|人|家|次|倍|㎡|平方米|公里|km|KM)?/g;
    const factCount = (bodyText.match(factRegex) || []).length;

    const faqKeywords = ["FAQ", "常见问题", "常见问答", "问答", "Q&A", "问题与解答"];
    const faqFound = faqKeywords.some(k =>
      bodyText.toLowerCase().includes(k.toLowerCase())
    );

    const questionMarkCount =
      (bodyText.match(/？/g) || []).length + (bodyText.match(/\?/g) || []).length;

    let score = 0;
    const details = [];

    let titleScore = 0;
    if (title) titleScore += 2;
    if (title.length >= 10 && title.length <= 80) titleScore += 2;
    score += titleScore;
    details.push({
      item: "Title",
      score: titleScore,
      max: 4,
      note: titleScore >= 3 ? "存在且长度合理" : "Title 缺失或过短/过长"
    });

    let metaScore = 0;
    if (metaDesc) metaScore += 2;
    if (metaDesc.length >= 30) metaScore += 2;
    score += metaScore;
    details.push({
      item: "Meta Description",
      score: metaScore,
      max: 4,
      note: metaScore >= 3 ? "存在且较完整" : "Meta 描述缺失或过短"
    });

    let hScore = 0;
    if (h1List.length >= 1) hScore += 2;
    if (h2List.length >= 1) hScore += 2;
    if (h2List.length >= 3) hScore += 1;
    score += hScore;
    details.push({
      item: "H1/H2 结构",
      score: hScore,
      max: 5,
      note: `H1 数量：${h1List.length}；H2 数量：${h2List.length}`
    });

    let textScore = 0;
    if (textLen >= 800) textScore += 3;
    if (textLen >= 1500) textScore += 2;
    score += textScore;
    details.push({
      item: "正文信息量",
      score: textScore,
      max: 5,
      note: `正文约 ${textLen} 字`
    });

    let jsonScore = 0;
    if (jsonldCount > 0) jsonScore += 2;
    if (validJsonldCount > 0) jsonScore += 2;
    score += jsonScore;
    details.push({
      item: "JSON-LD",
      score: jsonScore,
      max: 4,
      note: `发现 ${jsonldCount} 个，其中 ${validJsonldCount} 个可解析`
    });

    let factScore = 0;
    if (factCount >= 5) factScore += 3;
    if (factCount >= 10) factScore += 2;
    score += factScore;
    details.push({
      item: "可引用事实",
      score: factScore,
      max: 5,
      note: `检测到 ${factCount} 个数字/年份/百分比等事实痕迹`
    });

    let faqScore = 0;
    if (faqFound) faqScore += 2;
    if (questionMarkCount >= 3) faqScore += 1;
    score += faqScore;
    details.push({
      item: "FAQ / 问答痕迹",
      score: faqScore,
      max: 3,
      note: `FAQ 关键词：${faqFound ? "有" : "无"}；问号数量：${questionMarkCount}`
    });

    const suggestions = [];

    if (!title || title.length < 10) {
      suggestions.push("补充清晰的 Title，建议包含核心服务词、目标客户或核心问题。");
    }
    if (!metaDesc || metaDesc.length < 30) {
      suggestions.push("补充 Meta Description，用 1-2 句话说明页面服务对象、解决的问题和核心价值。");
    }
    if (h1List.length === 0) {
      suggestions.push("补充唯一 H1，让 AI 和搜索系统快速识别页面主题。");
    }
    if (h2List.length < 3) {
      suggestions.push("增加 H2 模块，例如“适合哪些企业”“常见问题”“服务流程”“交付成果”“客户案例”。");
    }
    if (textLen < 800) {
      suggestions.push("正文信息量偏少，建议补充服务对象、客户痛点、解决方案、流程和成果。");
    }
    if (jsonldCount === 0) {
      suggestions.push("补充 JSON-LD 结构化数据，优先考虑 Organization、WebPage、Service、Article、BreadcrumbList。");
    }
    if (factCount < 5) {
      suggestions.push("增加可引用事实，如年份、周期、客户数量、项目结果、百分比、阶段数量等。");
    }
    if (!faqFound) {
      suggestions.push("增加高质量 FAQ，但不要堆数量，要回答真实客户问题，并给出具体判断。");
    }
    if (suggestions.length === 0) {
      suggestions.push("页面基础 GEO 结构较完整，下一步可以做竞品对比和多平台引用测试。");
    }

    return jsonResponse({
      url: targetUrl,
      score,
      max_score: 30,
      title,
      meta_desc: metaDesc,
      h1_list: h1List,
      h2_list: h2List.slice(0, 30),
      text_len: textLen,
      jsonld_count: jsonldCount,
      valid_jsonld_count: validJsonldCount,
      schema_types: schemaTypes,
      fact_count: factCount,
      faq_found: faqFound,
      question_mark_count: questionMarkCount,
      details,
      suggestions,
      body_preview: bodyText.slice(0, 600)
    });
  } catch (e) {
    return jsonResponse({ error: e.message || String(e) }, 500);
  }
}