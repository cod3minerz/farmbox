"use client";

import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "./icons";
import { Button, useModalContainer } from "./ui";

const weeks = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const monthFormat = new Intl.DateTimeFormat("ru", { month: "long", year: "numeric" });
const dayFormat = new Intl.DateTimeFormat("ru", { dateStyle: "long" });
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isoDay(year: number, month: number, day: number) {
  return [year, (month + 1).toString().padStart(2, "0"), day.toString().padStart(2, "0")].join("-");
}

export function DateTimeField({ initialValue, timezone, onChange }: { initialValue: string; timezone: string; onChange: (value: string) => void }) {
  const [startDay, startTime] = initialValue.split("T");
  const [date, setDate] = useState(startDay);
  const [time, setTime] = useState(startTime || "18:00");
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startDay ? new Date(startDay + "T12:00") : new Date());
  const container = useModalContainer();
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const offset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const count = new Date(year, monthIndex + 1, 0).getDate();
  const today = new Date();
  const todayId = isoDay(today.getFullYear(), today.getMonth(), today.getDate());

  function change(day: string, clock: string) {
    onChange(day && timePattern.test(clock) ? day + "T" + clock : "");
  }

  return <div className="date-time">
    <div className="field"><span>Дата · {timezone}</span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button className="date-trigger" aria-label={date ? "Дата публикации: " + date.split("-").reverse().join(".") : "Выбрать дату публикации"}>
            <CalendarDays size={16} />{date ? date.split("-").reverse().join(".") : "Выбрать дату"}
          </Button>
        </Popover.Trigger>
        <Popover.Portal container={container}>
          <Popover.Content className="date-popup" align="start" sideOffset={5} collisionPadding={8} aria-label="Календарь публикации">
            <div className="calendar-nav">
              <Button className="icon-button" variant="ghost" aria-label="Предыдущий месяц" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}><ChevronLeft size={16} /></Button>
              <strong aria-live="polite">{monthFormat.format(month)}</strong>
              <Button className="icon-button" variant="ghost" aria-label="Следующий месяц" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}><ChevronRight size={16} /></Button>
            </div>
            <div className="calendar-days">
              {weeks.map((day) => <span key={day} className="weekday" aria-hidden="true">{day}</span>)}
              {Array.from({ length: offset }, (_, index) => <span key={"offset" + index} aria-hidden="true" />)}
              {Array.from({ length: count }, (_, index) => {
                const day = index + 1;
                const id = isoDay(year, monthIndex, day);
                return <button className="calendar-day" type="button" key={id} aria-label={dayFormat.format(new Date(year, monthIndex, day))}
                  aria-current={id === todayId ? "date" : undefined} aria-pressed={id === date}
                  onClick={() => { setDate(id); change(id, time); setOpen(false); }}>{day}</button>;
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
    <label className="field">Время
      <input className="control" type="text" placeholder="ЧЧ:ММ" title="Время в формате ЧЧ:ММ" maxLength={5} value={time} aria-invalid={!timePattern.test(time)}
        onChange={(event) => { const clock = event.target.value; setTime(clock); change(date, clock); }} />
    </label>
  </div>;
}
