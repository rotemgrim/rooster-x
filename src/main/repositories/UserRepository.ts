import {Container, Service} from "typedi";
import {Connection} from "typeorm";
import {InjectConnection} from "typeorm-typedi-extensions";
import {User} from "../../entity/User";
import {UserEpisode} from "../../entity/UserEpisode";
import {UserMetaData} from "../../entity/UserMetaData";
import * as path from "path";
import * as fs from "fs";
import AppGlobal from "../helpers/AppGlobal";

@Service()
export class UserRepository {

    @InjectConnection("reading")
    private connection: Connection;

    public getAllUsers() {
        const userRepo = this.connection.manager.getRepository(User);
        return userRepo.find();
    }

    public getUser(id) {
        console.log("find user by id", id);
        const userRepo = this.connection.manager.getRepository(User);
        return userRepo.findOne(id);
    }

    public createUser(payload: User) {
        console.log(payload);
        const userRepo = this.connection.manager.getRepository(User);
        const user = new User();
        user.firstName = payload.firstName;
        user.lastName = payload.lastName;
        user.password = payload.password;
        user.isAdmin = payload.isAdmin;
        return userRepo.insert(user);
    }

    public static startWatchedBackupInterval(interval = 3600) {
        setInterval(() => {
            Container.get(UserRepository).backupUsersWatched()
                .catch(console.error);
        }, interval * 1000);
    }

    public async backupUsersWatched() {
        console.info("start watched backup");
        const userRepo = this.connection.manager.getRepository(User);
        const userEpisodeRepo = this.connection.manager.getRepository(UserEpisode);
        const userMetaRepo = this.connection.manager.getRepository(UserMetaData);

        const users = await userRepo.find();
        if (!users) {
            console.error("no users found");
            return;
        }

        try {
            const backup: any = {
                lastBackup: new Date().toISOString(),
                users: [],
            };
            for (const u of users) {
                const uMediaWatched = await userMetaRepo.find({
                    where: {user: u, isWatched: true},
                    relations: ["metaData"],
                });
                const mediaWatched = uMediaWatched.map((o) => {
                    return {imdbId: o.metaData.imdbId};
                });
                const uEpisodeWatched = await userEpisodeRepo.find({
                    where: {user: u, isWatched: true},
                    relations: ["episode"],
                });
                const episodesWatched = uEpisodeWatched.map((o) => {
                    return {
                        imdbSeriesId: o.episode.imdbSeriesId,
                        imdbId: o.episode.imdbId,
                        season: o.episode.season,
                        episode: o.episode.episode,
                    };
                });
                const userData = {
                    id: u.id,
                    firstName: u.firstName,
                    lastName: u.lastName,
                    mediaWatched,
                    episodesWatched,
                };
                backup.users.push(userData);
            }
            // console.dir(backup);
            fs.writeFile(path.join(AppGlobal.getUserDataPath(), "watched.json"), JSON.stringify(backup), (err) => {
                if (err) {
                    console.error("could not save watched.json", err);
                }
                console.log("successfully written watched backup.");
            });
        } catch (e) {
            console.error("could not write watched backup", e);
        }
    }
}
