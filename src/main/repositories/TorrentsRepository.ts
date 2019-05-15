import {Container, Service} from "typedi";
import {Connection, In} from "typeorm";
import {InjectConnection} from "typeorm-typedi-extensions";
import {MetaData} from "../../entity/MetaData";
import RoRest from "../services/RoRest";
import {HTMLElement, parse} from "node-html-parser";
import {TorrentFile} from "../../entity/TorrentFile";
import {IMediaEntry} from "../../common/models/IMediaEntry";
import * as ptn from "../../common/lib/parse-torrent-name";
import {MediaRepository} from "./MediaRepository";
import IMDBController from "../controllers/IMDBController";
import {Alias} from "../../entity/Alias";

type TorrentLinks = Array<{title: string, magnet: string, timestamp: number}>;

@Service()
export class TorrentsRepository {

    @InjectConnection("reading")
    private connection: Connection;

    public static startTorrentsWatch(): void {
        setInterval(() => {
            const d = new Date();
            const minutes = d.getMinutes();
            const hours = d.getHours();
            if (hours === 18 && minutes >= 15 && minutes < 45) {
                Container.get(TorrentsRepository).reprocessTorrents()
                    .catch(console.error);
            }
        }, 1800 * 1000);
    }

    public async getAllTorrents() {
        const metaRepo = this.connection.manager.getRepository(MetaData);
        return metaRepo.find();
    }

    public async reprocessTorrents() {
        const links = await this.processTorrentzProvider();
        const metaRepo = this.connection.manager.getRepository(MetaData);
        const torrentRepo = this.connection.manager.getRepository(TorrentFile);
        const aliasRepo = this.connection.manager.getRepository(Alias);

        let done = 0;
        console.log("from " + links.length + " links");
        for (const link of links) {
            const mEntry: IMediaEntry = ptn(link.title);
            // console.log("");
            // console.log(link.title);

            if (Object.keys(mEntry).length >= 4) {
                // console.log(mEntry.title);
                // check if torrentFile exist
                const torrent = await torrentRepo.findOne({magnet: link.magnet});
                if (torrent) {
                    continue;
                }

                const tf = new TorrentFile();
                tf.title = mEntry.title;
                tf.raw = link.title;
                tf.magnet = link.magnet;
                tf.uploadedAt = link.timestamp;
                tf.year = mEntry.year;
                tf.resolution = mEntry.resolution || "";
                tf.quality = mEntry.quality || "";
                tf.codec = mEntry.codec || "";
                tf.audio = mEntry.audio || "";
                tf.group = mEntry.group || "";
                tf.region = mEntry.region || "";
                tf.language = mEntry.language || "";
                tf.extended = mEntry.extended || false;
                tf.hardcoded = mEntry.hardcoded || false;
                tf.proper = mEntry.proper || false;
                tf.repack = mEntry.repack || false;
                tf.wideScreen = mEntry.widescreen || false;

                // check if series
                if (mEntry.season && mEntry.episode) {
                    let series = await metaRepo.findOne({title: mEntry.title, type: "series"});
                    if (series) {
                        tf.metaData = series;
                    } else {
                        const alias = await aliasRepo.findOne({where: {alias: mEntry.title}});
                        if (alias) {
                            series = alias.metaData;
                            tf.metaData = series;
                        } else {
                            series = new MetaData();
                            series.title = mEntry.title;
                            series.type = "series";
                            tf.metaData = series;
                        }
                    }
                    tf.episode = await Container.get(MediaRepository).getEpisode(series, mEntry);
                } else if (mEntry.year) {
                    let movie = await metaRepo.findOne({title: mEntry.title, year: mEntry.year, type: "movie"});
                    if (movie) {
                        tf.metaData = movie;
                    } else {
                        const alias = await aliasRepo.findOne({where: {alias: mEntry.title}});
                        if (alias) {
                            tf.metaData = alias.metaData;
                        } else {
                            movie = new MetaData();
                            movie.title = mEntry.title;
                            movie.type = "movie";
                            tf.metaData = movie;
                        }
                    }
                }

                try {
                    // todo: figure out why we need to empty this before saving
                    if (tf.metaData && tf.metaData.userMetaData) {
                        delete tf.metaData.userMetaData;
                    }
                    if (tf.episode && tf.episode.userEpisode) {
                        delete tf.episode.userEpisode;
                    }
                    if (tf && tf.metaData && tf.metaData.status === "not-scanned") {
                        await IMDBController.getMetaDataFromInternetByMediaFile(tf)
                            .then(async (res) => {
                                const tFile = res;
                                tFile.metaData.status = "omdb";
                                await torrentRepo.save(tFile);
                                done++;
                            }).catch(async () => {
                                tf.metaData.status = "failed";
                                await torrentRepo.save(tf);
                            });
                    } else {
                        await torrentRepo.save(tf);
                    }
                } catch (e) {
                    console.error("could not save torrent to db", e);
                }
            }
        }
        console.log("done " + done + " links");
    }

    private async processTorrentzProvider() {
        let links: TorrentLinks = [];
        links = links.concat(await this.torrentzProviderGetPage(0));
        links = links.concat(await this.torrentzProviderGetPage(1));
        links = links.concat(await this.torrentzProviderGetPage(2));
        links = links.concat(await this.torrentzProviderGetPage(3));
        links = links.concat(await this.torrentzProviderGetPage(4));
        links = links.concat(await this.torrentzProviderGetPage(5));
        console.log(links.length);
        return links;
    }

    private async torrentzProviderGetPage(pg: number): Promise<TorrentLinks> {
        return new Promise((resolve) => {
            const links: TorrentLinks = [];
            RoRest.send("get", `https://torrentz2.eu/verifiedN?f=movies tv added:7d&p=${pg}&safe=1`)
                .then(html => {
                    const root = parse(html) as HTMLElement;
                    const selection = root.querySelectorAll("dl");
                    if (selection && selection.length > 0) {
                        selection.forEach((o: HTMLElement) => {
                            const anchorEl = o.querySelector("dt a");

                            if (anchorEl.innerHTML && anchorEl.attributes.hasOwnProperty("href")) {
                                const magnet = anchorEl.attributes.href.slice(1);
                                const timeEl = o.querySelectorAll("dd span")[1];
                                let timestamp = 0;
                                if (timeEl && timeEl.attributes.hasOwnProperty("title")) {
                                    timestamp = parseInt(timeEl.attributes.title, 10);
                                }
                                if (anchorEl.innerHTML.match(/^[a-zA-Z0-9 \.\!\?\[\]\-\(\)]*$/i)) {
                                    links.push({title: anchorEl.innerHTML, magnet, timestamp});
                                } else {
                                    // console.log("not matched", anchorEl.innerHTML);
                                }
                            }
                        });
                    }
                    resolve(links);
                }).catch(() => {
                    console.warn("could not finish torrents page scrape");
                    resolve(links);
            });
        });
    }
}
