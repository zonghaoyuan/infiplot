import Link from "next/link";
import { CustomForm } from "@/components/CustomForm";

export default function NewPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 md:px-16 pt-7 md:pt-10 flex items-center justify-between">
        <Link
          href="/"
          className="text-[10px] smallcaps text-clay-700 hover:text-clay-900 transition-colors flex items-center gap-2"
        >
          <i className="fa-solid fa-arrow-left text-[9px]" />
          InfiPlot
        </Link>
        <span className="text-[10px] smallcaps text-clay-500">
          编 织 一 个 世 界
        </span>
      </header>

      <section className="px-6 md:px-16 pt-20 md:pt-32 pb-20 md:pb-24 flex-1">
        <div className="grid grid-cols-12 gap-8 md:gap-16 max-w-6xl">
          <div className="col-span-12 md:col-span-4 animate-fade-in">
            <p className="text-[10px] smallcaps text-clay-500 mb-6">
              Ⅳ · 无 题
            </p>
            <h1 className="font-serif text-[44px] md:text-[64px] text-clay-900 leading-[0.96] mb-8">
              写下
              <br />
              <em className="italic text-clay-600">两段</em>
              <br />
              文字。
            </h1>
            <div className="hairline w-12 mb-6" />
            <p className="font-serif text-base text-clay-700 leading-[1.7]">
              第一段，勾勒故事所在的世界。第二段，描述世界应是什么模样 —
              它的介质、氛围、颗粒感。
            </p>
            <p className="font-serif italic text-sm text-clay-500 mt-5 leading-relaxed">
              两栏皆可任意语言。越具体，回报越具体。
            </p>
          </div>
          <div className="col-span-12 md:col-span-7 md:col-start-6">
            <CustomForm />
          </div>
        </div>
      </section>

      <footer className="px-6 md:px-16 pb-8">
        <div className="hairline-full w-full mb-4" />
        <div className="flex items-center justify-between text-[10px] smallcaps text-clay-500">
          <span>MMXXVI</span>
          <span className="num">Ⅰ · Ⅳ</span>
        </div>
      </footer>
    </div>
  );
}
