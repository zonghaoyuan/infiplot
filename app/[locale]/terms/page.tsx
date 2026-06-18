import type { Metadata } from "next";
import Link from "next/link";
import { localePath } from "@/lib/i18n/navigation";
import { isValidLocale } from "@/lib/i18n/utils";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";

export const metadata: Metadata = {
  title: "服务条款 — InfiPlot",
  description: "InfiPlot 服务条款：使用 InfiPlot 服务前请阅读本条款。",
};

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale: Locale = isValidLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const lp = (path: string) => localePath(path, locale);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 md:px-16 py-16 md:py-24">
      <Link
        href={lp("/")}
        className="inline-flex items-center gap-2 text-clay-500 hover:text-ember-500 transition-colors text-sm mb-12"
      >
        <i className="fa-solid fa-arrow-left text-xs" />
        <span>返回首页</span>
      </Link>

      <h1 className="font-serif text-3xl md:text-4xl text-clay-900 mb-4">
        服务条款
      </h1>
      <p className="text-sm text-clay-500 mb-12">
        生效日期：2026 年 6 月 14 日 &nbsp;|&nbsp; 最后更新：2026 年 6 月 14 日
      </p>

      <div className="hairline-full w-full mb-12" />

      <div className="space-y-10 text-clay-800 text-[15px] leading-[1.85]">
        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            服务说明
          </h2>
          <p>
            InfiPlot（以下简称"我们"或"本服务"）是一款用 AI
            实时生成图片、语音与剧情分支的交互式剧情游戏。本服务目前处于公测阶段，功能和可用性可能随时发生变化。
          </p>
          <p className="mt-3">
            使用本服务即表示您同意遵守本服务条款。如果您不同意本条款的任何部分，请停止使用本服务。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            账户与登录
          </h2>
          <p>
            您可以通过 Google、GitHub 账户或电子邮件验证码登录本服务。您有责任保管好自己的账户凭证，并对通过您的账户进行的所有活动负责。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            用户行为准则
          </h2>
          <p>使用本服务时，您同意不会：</p>
          <ul className="list-disc pl-6 space-y-1 mt-3">
            <li>利用本服务生成违反法律法规的内容。</li>
            <li>尝试对服务进行逆向工程、攻击或以非正常方式使用 API。</li>
            <li>干扰或破坏服务的正常运行，或对服务基础设施造成不合理的负担。</li>
            <li>冒充他人或虚假陈述您与任何个人或实体的关系。</li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            AI 生成内容
          </h2>
          <p>
            本服务中的图片、文字、语音等内容均由 AI
            实时生成。AI 生成的内容不代表本团队的观点或立场。我们无法完全控制 AI
            生成内容的准确性、适当性或完整性。
          </p>
          <p className="mt-3">
            您理解并同意，AI
            生成的内容可能存在不准确、不恰当或令人不适的情况。您应自行判断和承担使用
            AI 生成内容的风险。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            知识产权
          </h2>
          <p>
            InfiPlot 的源代码基于{" "}
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ember-500 hover:text-ember-400 transition-colors underline decoration-clay-900/20 underline-offset-2"
            >
              AGPL-3.0
            </a>{" "}
            许可证开源。
          </p>
          <p className="mt-3">
            通过本服务生成的游戏内容（包括故事文本、图片和语音）由您在游戏会话期间创造性地引导产生。我们不主张对您个人游戏会话中生成的内容拥有所有权。
          </p>
          <p className="mt-3">
            外部贡献者向开源项目提交代码前，需先签署一次《贡献者许可协议》（CLA），明确授予项目维护者将相关贡献用于本服务（含闭源版本）的权利。详见 GitHub 仓库中的{" "}
            <a
              href="https://github.com/zonghaoyuan/infiplot/blob/staging/CLA.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ember-500 hover:text-ember-400 transition-colors underline decoration-clay-900/20 underline-offset-2"
            >
              CLA.md
            </a>
            （<a
              href="https://github.com/zonghaoyuan/infiplot/blob/staging/CLA.zh.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ember-500 hover:text-ember-400 transition-colors underline decoration-clay-900/20 underline-offset-2"
            >
              中文参考译文</a>）。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            数据与隐私
          </h2>
          <p>
            公测期间生成的游戏内容不会被持久保存在我们的服务器上。为提供 AI 生成服务，相关内容会在请求处理过程中临时传输和处理，处理完成后不会被保留。有关我们如何处理您的个人信息，请参阅我们的{" "}
            <Link
              href={lp("/privacy")}
              className="text-ember-500 hover:text-ember-400 transition-colors underline decoration-clay-900/20 underline-offset-2"
            >
              隐私政策
            </Link>
            。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            服务可用性
          </h2>
          <p>
            本服务目前处于公测阶段，免费提供使用。我们不保证服务的持续可用性、稳定性或性能。服务可能会因维护、升级或不可抗力因素而中断。
          </p>
          <p className="mt-3">
            我们保留随时修改、暂停或终止服务（或其任何部分）的权利，无论是否通知。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            免责声明
          </h2>
          <p>
            本服务按"现状"和"可用"的基础提供，不附带任何明示或暗示的保证。在法律允许的最大范围内，我们明确否认所有保证，包括但不限于对适销性、特定用途适用性和非侵权性的暗示保证。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            责任限制
          </h2>
          <p>
            在法律允许的最大范围内，InfiPlot
            团队及其成员在任何情况下均不对因使用或无法使用本服务而产生的任何间接、附带、特殊、后果性或惩罚性损害负责。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            账户终止
          </h2>
          <p>
            我们保留在以下情况下暂停或终止您的账户的权利：
          </p>
          <ul className="list-disc pl-6 space-y-1 mt-3">
            <li>您违反了本服务条款。</li>
            <li>您的行为对服务或其他用户构成风险。</li>
            <li>法律法规要求我们这样做。</li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            条款变更
          </h2>
          <p>
            我们可能会不时更新本服务条款。如有重大变更，我们将通过在网站上发布更新后的条款来通知您。继续使用本服务即表示您接受更新后的条款。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">联系我们</h2>
          <p>
            如果您对本服务条款有任何疑问，请通过以下方式联系我们：
          </p>
          <p className="mt-3">
            邮箱：{" "}
            <a
              href="mailto:hi@infiplot.com"
              className="text-ember-500 hover:text-ember-400 transition-colors"
            >
              hi@infiplot.com
            </a>
          </p>
        </section>
      </div>

      <div className="hairline-full w-full mt-16 mb-8" />

      <footer className="text-center text-[10px] smallcaps text-clay-500 pb-10">
        <span>© 2026 InfiPlot. All rights reserved.</span>
      </footer>
    </main>
  );
}
