import json
import re
import requests
from bs4 import BeautifulSoup
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


def clean_text(s):
    if not s:
        return ""
    return re.sub(r"\s+", " ", s).strip()


def fetch_html(url):
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0 Safari/537.36"
        )
    }
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return resp.text


def analyze(url):
    html = fetch_html(url)
    soup = BeautifulSoup(html, "lxml")

    raw_soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    title = clean_text(soup.title.get_text()) if soup.title else ""

    meta_desc = ""
    desc_tag = raw_soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    if desc_tag and desc_tag.get("content"):
        meta_desc = clean_text(desc_tag.get("content"))

    h1_list = [clean_text(h.get_text()) for h in soup.find_all("h1")]
    h2_list = [clean_text(h.get_text()) for h in soup.find_all("h2")]

    body_text = clean_text(soup.get_text(" "))
    text_len = len(body_text)

    jsonld_tags = raw_soup.find_all("script", attrs={"type": "application/ld+json"})
    jsonld_count = len(jsonld_tags)
    valid_jsonld_count = 0
    schema_types = []

    for tag in jsonld_tags:
        try:
            data = json.loads(tag.string or "")
            valid_jsonld_count += 1
            if isinstance(data, dict) and data.get("@type"):
                schema_types.append(str(data.get("@type")))
            elif isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and item.get("@type"):
                        schema_types.append(str(item.get("@type")))
        except Exception:
            pass

    fact_pattern = r"\d+(\.\d+)?\s*(%|％|年|个月|月|天|小时|分钟|万元|亿元|元|人|家|次|倍|㎡|平方米|公里|km|KM)?"
    fact_count = len(re.findall(fact_pattern, body_text))

    faq_keywords = ["FAQ", "常见问题", "常见问答", "问答", "Q&A", "问题与解答"]
    faq_found = any(k.lower() in body_text.lower() for k in faq_keywords)
    question_mark_count = body_text.count("？") + body_text.count("?")

    score = 0
    details = []

    title_score = 0
    if title:
        title_score += 2
    if 10 <= len(title) <= 80:
        title_score += 2
    score += title_score
    details.append({"item": "Title", "score": title_score, "max": 4, "note": "存在且长度合理" if title_score >= 3 else "Title 缺失或过短/过长"})

    meta_score = 0
    if meta_desc:
        meta_score += 2
    if len(meta_desc) >= 30:
        meta_score += 2
    score += meta_score
    details.append({"item": "Meta Description", "score": meta_score, "max": 4, "note": "存在且较完整" if meta_score >= 3 else "Meta 描述缺失或过短"})

    h_score = 0
    if len(h1_list) >= 1:
        h_score += 2
    if len(h2_list) >= 1:
        h_score += 2
    if len(h2_list) >= 3:
        h_score += 1
    score += h_score
    details.append({"item": "H1/H2 结构", "score": h_score, "max": 5, "note": f"H1 数量：{len(h1_list)}；H2 数量：{len(h2_list)}"})

    text_score = 0
    if text_len >= 800:
        text_score += 3
    if text_len >= 1500:
        text_score += 2
    score += text_score
    details.append({"item": "正文信息量", "score": text_score, "max": 5, "note": f"正文约 {text_len} 字"})

    json_score = 0
    if jsonld_count > 0:
        json_score += 2
    if valid_jsonld_count > 0:
        json_score += 2
    score += json_score
    details.append({"item": "JSON-LD", "score": json_score, "max": 4, "note": f"发现 {jsonld_count} 个，其中 {valid_jsonld_count} 个可解析"})

    fact_score = 0
    if fact_count >= 5:
        fact_score += 3
    if fact_count >= 10:
        fact_score += 2
    score += fact_score
    details.append({"item": "可引用事实", "score": fact_score, "max": 5, "note": f"检测到 {fact_count} 个数字/年份/百分比等事实痕迹"})

    faq_score = 0
    if faq_found:
        faq_score += 2
    if question_mark_count >= 3:
        faq_score += 1
    score += faq_score
    details.append({"item": "FAQ / 问答痕迹", "score": faq_score, "max": 3, "note": f"FAQ 关键词：{'有' if faq_found else '无'}；问号数量：{question_mark_count}"})

    suggestions = []
    if not title or len(title) < 10:
        suggestions.append("补充清晰的 Title，建议包含核心服务词、目标客户或核心问题。")
    if not meta_desc or len(meta_desc) < 30:
        suggestions.append("补充 Meta Description，用 1-2 句话说明页面服务对象、解决的问题和核心价值。")
    if len(h1_list) == 0:
        suggestions.append("补充唯一 H1，让 AI 和搜索系统快速识别页面主题。")
    if len(h2_list) < 3:
        suggestions.append("增加 H2 模块，例如“适合哪些企业”“常见问题”“服务流程”“交付成果”“客户案例”。")
    if text_len < 800:
        suggestions.append("正文信息量偏少，建议补充服务对象、客户痛点、解决方案、流程和成果。")
    if jsonld_count == 0:
        suggestions.append("补充 JSON-LD 结构化数据，优先考虑 Organization、WebPage、Service、Article、BreadcrumbList。")
    if fact_count < 5:
        suggestions.append("增加可引用事实，如年份、周期、客户数量、项目结果、百分比、阶段数量等。")
    if not faq_found:
        suggestions.append("增加高质量 FAQ，但不要堆数量，要回答真实客户问题，并给出具体判断。")
    if not suggestions:
        suggestions.append("页面基础 GEO 结构较完整，下一步可以做竞品对比和多平台引用测试。")

    return {
        "url": url,
        "score": score,
        "max_score": 30,
        "title": title,
        "meta_desc": meta_desc,
        "h1_list": h1_list,
        "h2_list": h2_list[:30],
        "text_len": text_len,
        "jsonld_count": jsonld_count,
        "valid_jsonld_count": valid_jsonld_count,
        "schema_types": schema_types,
        "fact_count": fact_count,
        "faq_found": faq_found,
        "question_mark_count": question_mark_count,
        "details": details,
        "suggestions": suggestions,
        "body_preview": body_text[:600],
    }


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        try:
            query = parse_qs(urlparse(self.path).query)
            url = query.get("url", [""])[0].strip()

            if not url.startswith("http"):
                self.send_json({"error": "请输入完整网址，例如：https://www.szbring.com/"}, status=400)
                return

            result = analyze(url)
            self.send_json(result)

        except Exception as e:
            self.send_json({"error": str(e)}, status=500)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)