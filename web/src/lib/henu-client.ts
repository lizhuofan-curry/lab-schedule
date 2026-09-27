import { createCipheriv } from "node:crypto";
import iconv from "iconv-lite";

// 河大统一身份认证（IDS）登录 + 选课系统课表抓取。
// 接口细节见 docs/08-河大教务系统接口.md。只做只读抓取，不实现选课提交。

const AES_CHARS = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BASE_URL = "https://xk.henu.edu.cn";
const CAS_LOGIN_URL = "https://ids.henu.edu.cn/authserver/login";
const REQUEST_TIMEOUT_MS = 15_000;

function randomString(length: number) {
  let result = "";
  for (let i = 0; i < length; i += 1) result += AES_CHARS[Math.floor(Math.random() * AES_CHARS.length)];
  return result;
}

// 与河大前端一致的 AES-128-CBC：密钥 = salt，明文 = 64 位随机前缀 + 密码，IV 随机 16 位。
function encryptPassword(password: string, salt: string) {
  const prefix = randomString(64);
  const iv = randomString(16);
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(salt, "utf8"), Buffer.from(iv, "utf8"));
  return Buffer.concat([cipher.update(prefix + password, "utf8"), cipher.final()]).toString("base64");
}

class CookieJar {
  private cookies = new Map<string, string>();

  store(setCookies: string[]) {
    for (const setCookie of setCookies) {
      const [pair] = setCookie.split(";");
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function decodeText(buffer: ArrayBuffer) {
  const bytes = Buffer.from(buffer);
  const utf8 = iconv.decode(bytes, "utf8");
  // 若 utf8 解码出现替换字符，则按 GBK 重新解码（河大老系统常见编码）。
  return utf8.includes("�") ? iconv.decode(bytes, "gbk") : utf8;
}

export class HenuClient {
  private jar = new CookieJar();

  // 跟重定向 + 自动维护 Cookie（Node fetch 不会自动管理 Cookie）。
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    let currentUrl = url;
    let options = init;
    for (let hop = 0; hop < 12; hop += 1) {
      const response = await fetch(currentUrl, {
        ...options,
        headers: {
          "user-agent": USER_AGENT,
          ...(options.headers as Record<string, string> | undefined),
          cookie: this.jar.header(),
        },
        redirect: "manual",
        signal: init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      this.jar.store(response.headers.getSetCookie?.() ?? []);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return response;
        currentUrl = new URL(location, currentUrl).toString();
        options = { method: "GET" }; // 302 跟随为 GET
        continue;
      }
      return response;
    }
    throw new Error("重定向次数过多，登录流程异常");
  }

  async login(username: string, password: string) {
    const serviceUrl = `${BASE_URL}/caslogin`;
    const loginPageUrl = `${CAS_LOGIN_URL}?service=${encodeURIComponent(serviceUrl)}`;

    const page = await this.request(loginPageUrl);
    const html = decodeText(await page.arrayBuffer());
    const execution = html.match(/name="execution" value="([^"]*)"/)?.[1];
    const salt = html.match(/id="pwdEncryptSalt" value="([^"]*)"/)?.[1];
    if (!execution || !salt) {
      if (page.status === 200 && /验证码|captcha/i.test(html)) throw new Error("统一认证需要验证码，请稍后再试。");
      throw new Error("登录页缺少 execution 或 salt，可能是认证页面结构变化。");
    }

    const form = new URLSearchParams({
      username,
      password: encryptPassword(password, salt),
      captcha: "",
      _eventId: "submit",
      cllt: "userNameLogin",
      dllt: "generalLogin",
      lt: "",
      execution,
    });

    // 提交到第一次 GET 后的最终 URL（登录表单实际 action），并跟随 CAS ticket 重定向。
    await this.request(page.url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    // 用身份上下文验证是否真正登录：guest 说明登录失败或降级为游客。
    const context = await this.fetchContext();
    const loginId = context.loginId.toLowerCase();
    if (!loginId || loginId === "guest" || loginId === "kingo.guest") {
      throw new Error("登录失败，请检查学号和密码。");
    }
    return context;
  }

  // 从 SetMainInfo.jsp 提取当前学年学期与登录号。
  async fetchContext() {
    const response = await this.request(`${BASE_URL}/frame/home/js/SetMainInfo.jsp`);
    const html = decodeText(await response.arrayBuffer());
    const pick = (name: string) => html.match(new RegExp(`var\\s+${name}\\s*=\\s*'([^']*)'`))?.[1] ?? "";
    return {
      loginId: pick("_loginid") || pick("G_LOGIN_ID"),
      xn: pick("_currentXn"),
      xq: pick("_currentXq"),
      schoolCode: pick("_schoolCode") || pick("G_SCHOOL_CODE"),
    };
  }

  // 从课表入口页 HTML 里提取列表/网格数据接口路径（接口有 iframe 上下文依赖，直接访问会报「无效访问请求」）。
  private extractDataPaths(html: string) {
    const defaultList = "../wsxk/xkjg.ckdgxsxdkchj_data10319.jsp";
    const defaultGrid = "../student/wsxk.xskcb10319.jsp";

    const frmaction = html.match(/frmaction\s*=\s*[^;]*\?\s*["']([^"']+)["']\s*:\s*["']([^"']+)["']/i);
    if (frmaction) return { listPath: frmaction[1], gridPath: frmaction[2] };

    let listPath = "";
    let gridPath = "";
    for (const raw of html.match(/["'][^"']+\.jsp["']/gi) ?? []) {
      const path = raw.slice(1, -1);
      const lower = path.toLowerCase();
      if (!listPath && (lower.includes("ckdgxsxdkchj_data") || (lower.includes("xkjg") && lower.includes("data")))) listPath = path;
      if (!gridPath && lower.includes("xskcb") && !lower.includes("excel") && !lower.includes("_exp")) gridPath = path;
      if (listPath && gridPath) break;
    }
    return { listPath: listPath || defaultList, gridPath: gridPath || defaultGrid };
  }

  // 抓取完整课表：先访问入口页建立上下文并提取数据接口，再用 base64 参数 + Referer 请求网格数据。
  async fetchSchedule() {
    const context = await this.fetchContext();

    const entryUrl = `${BASE_URL}/student/xkjg.wdkb.jsp`;
    const entry = await this.request(entryUrl);
    const entryHtml = decodeText(await entry.arrayBuffer());

    const { gridPath } = this.extractDataPaths(entryHtml);
    const rawParams = `xn=${context.xn}&xq=${context.xq}&xh=${context.loginId}`;
    const encodedParams = Buffer.from(rawParams, "utf8").toString("base64");
    const gridUrl = new URL(gridPath, entryUrl).toString();

    const grid = await this.request(`${gridUrl}?params=${encodedParams}`, { headers: { referer: entryUrl } });
    const gridHtml = decodeText(await grid.arrayBuffer());

    return { context, entryHtml, gridHtml, gridUrl };
  }
}
