import type { Metadata } from "next";
import Link from "next/link";
import { localePath } from "@/lib/i18n/navigation";
import { isValidLocale } from "@/lib/i18n/utils";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";

export const metadata: Metadata = {
  title: "隐私政策 — InfiPlot",
  description: "InfiPlot 隐私政策：了解我们如何收集、使用和保护您的个人信息。",
};

export default async function PrivacyPage({
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
        隐私政策
      </h1>
      <p className="text-sm text-clay-500 mb-12">
        生效日期：2026 年 6 月 14 日 &nbsp;|&nbsp; 最后更新：2026 年 6 月 14 日
      </p>

      <div className="hairline-full w-full mb-12" />

      <div className="space-y-10 text-clay-800 text-[15px] leading-[1.85]">
        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">概述</h2>
          <p>
            InfiPlot（以下简称"我们"）是一款用 AI
            实时生成内容的交互式剧情游戏。我们重视您的隐私，并致力于以透明的方式处理您的个人信息。本隐私政策说明了我们在您使用
            InfiPlot 服务时如何收集、使用、存储和保护您的数据。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            我们收集的信息
          </h2>
          <p className="mb-3">
            当您通过第三方账号（Google 或 GitHub）登录时，我们会接收以下信息：
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>您的电子邮件地址</li>
            <li>您的显示名称</li>
            <li>您的头像图片 URL</li>
          </ul>
          <p className="mt-3">
            当您通过电子邮件验证码登录时，我们仅收集您的电子邮件地址。
          </p>
          <p className="mt-3">
            您在游戏中输入的故事提示词和对话选择会被传输至服务器以供 AI 模型实时处理，但不会在我们的服务器上持久存储。游戏会话结束后，相关数据不会被保留。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            我们如何使用您的信息
          </h2>
          <p>我们仅将收集到的信息用于以下目的：</p>
          <ul className="list-disc pl-6 space-y-1 mt-3">
            <li>
              <strong>身份验证</strong>
              ：验证您的身份并维持登录状态。
            </li>
            <li>
              <strong>个性化显示</strong>
              ：在界面中展示您的用户名和头像。
            </li>
            <li>
              <strong>服务沟通</strong>
              ：使用您的电子邮件地址向您发送与服务相关的重要通知，例如产品更新、功能变更或运营信息。
            </li>
          </ul>
          <p className="mt-3">
            我们不会将您的个人信息用于广告投放、用户画像、行为分析或任何其他未在本政策中明确说明的用途。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            数据存储与安全
          </h2>
          <p>
            您的账户信息存储在{" "}
            <a
              href="https://supabase.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ember-500 hover:text-ember-400 transition-colors underline decoration-clay-900/20 underline-offset-2"
            >
              Supabase
            </a>{" "}
            提供的托管数据库中。Supabase
            采用行业标准的安全措施来保护数据，包括传输加密（TLS）和静态加密。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            第三方共享
          </h2>
          <p>
            我们不会出售、出租或以其他方式向第三方共享您的个人信息。我们不会将您的数据用于第三方广告或营销目的。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            数据保留与删除
          </h2>
          <p>
            我们在您持有有效账户期间保留您的账户信息。您可以随时通过发送邮件至{" "}
            <a
              href="mailto:hi@infiplot.com"
              className="text-ember-500 hover:text-ember-400 transition-colors"
            >
              hi@infiplot.com
            </a>{" "}
            请求删除您的账户及所有相关数据。我们将在收到请求后的 30
            个自然日内完成数据删除。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            匿名统计分析
          </h2>
          <p>
            本站可能使用开源的{" "}
            <a
              href="https://umami.is/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ember-500 hover:text-ember-400 transition-colors underline decoration-clay-900/20 underline-offset-2"
            >
              Umami
            </a>{" "}
            进行隐私友好的匿名访问与交互统计。该分析工具不使用
            Cookie、不收集个人信息、不发送任何您输入的内容、不做跨站追踪。此功能为可选配置，可能不会在所有部署中启用。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            Google API 服务用户数据政策
          </h2>
          <p>
            InfiPlot 对通过 Google API
            获取的用户数据的使用和转移，遵守{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ember-500 hover:text-ember-400 transition-colors underline decoration-clay-900/20 underline-offset-2"
            >
              Google API Services User Data Policy
            </a>
            ，包括有限使用（Limited Use）要求。具体而言：
          </p>
          <ul className="list-disc pl-6 space-y-1 mt-3">
            <li>我们仅请求提供服务所必需的最小权限范围（电子邮件、个人资料）。</li>
            <li>我们不会将 Google 用户数据用于广告投放或再营销。</li>
            <li>我们不会将 Google 用户数据出售给第三方。</li>
            <li>我们不会将 Google 用户数据用于信用评估或贷款。</li>
            <li>我们不会将 Google 用户数据用于训练通用 AI/ML 模型。</li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            儿童隐私
          </h2>
          <p>
            InfiPlot
            不面向 13 岁以下的儿童。我们不会有意收集 13
            岁以下儿童的个人信息。如果您认为我们无意中收集了儿童的信息，请联系我们，我们将立即采取措施删除相关数据。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">
            隐私政策的变更
          </h2>
          <p>
            我们可能会不时更新本隐私政策。如有重大变更，我们将通过在网站上发布更新后的政策并修改"最后更新"日期来通知您。继续使用我们的服务即表示您接受更新后的隐私政策。
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-clay-900 mb-3">联系我们</h2>
          <p>
            如果您对本隐私政策有任何疑问或希望行使您的数据权利，请通过以下方式联系我们：
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
